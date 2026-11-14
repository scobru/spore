use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::thread;

static PROXIES: OnceLock<Mutex<HashMap<String, u16>>> = OnceLock::new();

fn proxies_map() -> &'static Mutex<HashMap<String, u16>> {
    PROXIES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn parse_ws_target(target_url: &str) -> Option<(String, String)> {
    let rest = target_url.strip_prefix("ws://")?;
    let (authority, path_and_query) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };
    if authority.is_empty() {
        return None;
    }
    let upstream_addr = if authority.contains(':') {
        authority.to_string()
    } else {
        format!("{authority}:80")
    };
    Some((upstream_addr, path_and_query.to_string()))
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn handle_client(mut client: TcpStream, upstream_addr: String) {
    let mut buf = Vec::with_capacity(4096);
    let mut tmp = [0u8; 2048];
    let header_end = loop {
        match client.read(&mut tmp) {
            Ok(0) => return,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if let Some(pos) = find_header_end(&buf) {
                    break pos;
                }
                if buf.len() > 64 * 1024 {
                    return;
                }
            }
            Err(_) => return,
        }
    };

    let Ok(header_str) = std::str::from_utf8(&buf[..header_end]) else {
        return;
    };
    let trailing = &buf[header_end + 4..];

    let mut lines = header_str.split("\r\n");
    let Some(request_line) = lines.next() else {
        return;
    };

    let mut out = String::with_capacity(header_str.len() + 64);
    out.push_str(request_line);
    out.push_str("\r\n");

    for line in lines {
        if line.is_empty() {
            continue;
        }
        let lower = line.to_ascii_lowercase();
        // Freenet rejects WebSocket upgrades from Tauri's http://tauri.localhost origin.
        if lower.starts_with("origin:") {
            continue;
        }
        if lower.starts_with("host:") {
            out.push_str(&format!("Host: {upstream_addr}\r\n"));
            continue;
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    out.push_str("\r\n");

    let Ok(mut upstream) = TcpStream::connect(&upstream_addr) else {
        let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
        return;
    };

    if upstream.write_all(out.as_bytes()).is_err() {
        return;
    }
    if !trailing.is_empty() && upstream.write_all(trailing).is_err() {
        return;
    }

    let Ok(mut client_read) = client.try_clone() else {
        return;
    };
    let Ok(mut upstream_write) = upstream.try_clone() else {
        return;
    };

    thread::spawn(move || {
        let _ = std::io::copy(&mut client_read, &mut upstream_write);
        let _ = upstream_write.shutdown(Shutdown::Both);
        let _ = client_read.shutdown(Shutdown::Both);
    });

    let _ = std::io::copy(&mut upstream, &mut client);
    let _ = client.shutdown(Shutdown::Both);
    let _ = upstream.shutdown(Shutdown::Both);
}

/// Returns a local `ws://127.0.0.1:<port>/...` proxy URL that strips the `Origin`
/// header before forwarding to the local Freenet node. Non-`ws://` URLs are returned as-is.
pub fn get_proxy_ws_url(target_url: &str) -> Result<String, String> {
    let Some((upstream_addr, path_and_query)) = parse_ws_target(target_url) else {
        return Ok(target_url.to_string());
    };

    let mut map = proxies_map()
        .lock()
        .map_err(|_| "Proxy lock poisoned".to_string())?;

    let port = if let Some(&existing_port) = map.get(&upstream_addr) {
        existing_port
    } else {
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to bind local WS proxy: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to read proxy addr: {e}"))?
            .port();
        let addr_clone = upstream_addr.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let target = addr_clone.clone();
                thread::spawn(move || handle_client(stream, target));
            }
        });
        map.insert(upstream_addr, port);
        port
    };

    Ok(format!("ws://127.0.0.1:{port}{path_and_query}"))
}
