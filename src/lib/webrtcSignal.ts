// Manual (serverless) WebRTC signaling for Spore Radio: no signaling server, no Freenet contract.
// The broadcaster generates an "invite code" (their SDP offer, base64), the listener pastes it in and
// gets back an "answer code" which they send to the broadcaster (e.g. as a Radica DM) to complete the
// one-to-one connection. Audio then flows peer-to-peer over the resulting RTCPeerConnection's track.
//
// shortcut: STUN-only (stun.l.google.com), no TURN relay, so a connection between two peers both behind
// symmetric NAT can fail to establish. Upgrade: add a TURN server to RTC_CONFIG when that happens often.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function encodeSignal(desc: RTCSessionDescriptionInit): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(desc))));
}

function decodeSignal(code: string): RTCSessionDescriptionInit {
  return JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
}

/** Non-trickle ICE: wait for gathering to finish so the one exchanged code carries every candidate.
 *  Caps the wait at 4s: a flaky network (or a STUN server that never answers) must not hang the UI
 *  forever — proceeding with whatever candidates gathered so far still works on a shared LAN, and
 *  otherwise the connection simply fails to establish rather than the invite/answer code never appearing. */
function waitIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    pc.addEventListener("icegatheringstatechange", check);
    const timer = setTimeout(done, 4000);
  });
}

/** Broadcaster side: start one connection for one listener, offering `stream` (see captureBroadcastStream). */
export async function createRadioOffer(stream: MediaStream): Promise<{ pc: RTCPeerConnection; inviteCode: string }> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceGatheringComplete(pc);
  return { pc, inviteCode: encodeSignal(pc.localDescription!) };
}

/** Broadcaster side: finish the handshake once the listener sends back their answer code. */
export async function completeRadioOffer(pc: RTCPeerConnection, answerCode: string): Promise<void> {
  await pc.setRemoteDescription(decodeSignal(answerCode));
}

/** Listener side: paste the broadcaster's invite code, get back an answer code to send them, and the
 *  incoming audio stream (resolves once the first track arrives). */
export async function joinRadioOffer(
  inviteCode: string
): Promise<{ pc: RTCPeerConnection; answerCode: string; remoteStream: Promise<MediaStream> }> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const remoteStream = new Promise<MediaStream>((resolve) => {
    pc.addEventListener("track", (e) => resolve(e.streams[0]), { once: true });
  });
  await pc.setRemoteDescription(decodeSignal(inviteCode));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIceGatheringComplete(pc);
  return { pc, answerCode: encodeSignal(pc.localDescription!), remoteStream };
}
