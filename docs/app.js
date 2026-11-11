// Spore Landing Page Interactive Simulator
// 100% Self-Contained: Zero external libraries, vanilla JS, runs on Freenet & Web

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initEqualizer();
  initSearch();
  initCopyButtons();
});

// 1. Tab Switching Logic
function initTabs() {
  const tabBtns = document.querySelectorAll('.sim-tab-btn');
  const tabContents = document.querySelectorAll('.sim-tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetContent = document.getElementById(`tab-${targetTab}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });
}

// 2. Audio Equalizer Visualizer on Canvas
let isPlaying = true;
let animFrameId = null;

function initEqualizer() {
  const canvas = document.getElementById('radio-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const playBtn = document.getElementById('radio-play-toggle');
  const statusBadge = document.getElementById('radio-status-text');

  // Set real canvas resolution matching CSS size
  function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = 80;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const numBars = 32;
  const barData = new Array(numBars).fill(10);

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / numBars) - 2;

    for (let i = 0; i < numBars; i++) {
      if (isPlaying) {
        // Organic sinusoidal motion with random audio-like jitter
        const freq = Math.sin(Date.now() * 0.005 + i * 0.3);
        const target = 15 + Math.abs(freq) * 45 + (Math.random() * 18);
        barData[i] += (target - barData[i]) * 0.25;
      } else {
        // Idle gentle floor
        barData[i] += (4 - barData[i]) * 0.1;
      }

      const h = Math.max(4, Math.min(canvas.height, barData[i]));
      const x = i * (barWidth + 2);
      const y = canvas.height - h;

      // Color gradient (Emerald to Cyan)
      const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
      grad.addColorStop(0, '#059669');
      grad.addColorStop(0.6, '#10b981');
      grad.addColorStop(1, '#38bdf8');

      ctx.fillStyle = isPlaying ? grad : '#334155';
      ctx.fillRect(x, y, barWidth, h);
    }

    animFrameId = requestAnimationFrame(draw);
  }

  draw();

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playBtn.innerHTML = isPlaying ? '⏸' : '▶';
      if (statusBadge) {
        statusBadge.textContent = isPlaying ? 'ON AIR' : 'PAUSED';
      }
    });
  }

  // Simulated Uptime Counter
  const uptimeEl = document.getElementById('radio-uptime');
  if (uptimeEl) {
    let seconds = 342;
    setInterval(() => {
      if (!isPlaying) return;
      seconds++;
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      uptimeEl.textContent = `${m}m ${s < 10 ? '0' : ''}${s}s`;
    }, 1000);
  }

  // Simulated Ring Buffer Slot Cycling
  const slotEl = document.getElementById('radio-slot-index');
  const slotBoxes = document.querySelectorAll('.slot-box');
  let currentSlot = 2;

  setInterval(() => {
    if (!isPlaying) return;
    currentSlot = (currentSlot + 1) % 4;
    if (slotEl) slotEl.textContent = `#${currentSlot}`;

    slotBoxes.forEach((box, idx) => {
      if (idx === currentSlot) {
        box.classList.add('active');
      } else {
        box.classList.remove('active');
      }
    });
  }, 6000);
}

// 3. Crate Digging Search Simulation
function initSearch() {
  const searchInput = document.getElementById('mock-search-input');
  const tableBody = document.getElementById('mock-table-body');
  const pills = document.querySelectorAll('.search-pill');

  if (!searchInput || !tableBody) return;

  const sampleTracks = [
    { title: "Resonance (24-bit Vinyl Rip)", artist: "HOME", album: "Odyssey", genre: "Synthwave", format: "FLAC", size: "48.2 MB", peer: "berlin_node", speed: "12.4 MB/s" },
    { title: "Xtal (Original 1992 Cassette)", artist: "Aphex Twin", album: "Selected Ambient Works", genre: "IDM / Ambient", format: "FLAC", size: "39.1 MB", peer: "bristol_crate", speed: "9.8 MB/s" },
    { title: "Nightcall (Drive Sovereign Edit)", artist: "Kavinsky", album: "OutRun", genre: "Electro", format: "MP3", size: "9.4 MB", peer: "paris_dj", speed: "14.2 MB/s" },
    { title: "Windowlicker (Acid Rework)", artist: "Aphex Twin", album: "Windowlicker EP", genre: "Breakbeat", format: "FLAC", size: "62.0 MB", peer: "local_share", speed: "25.0 MB/s" },
    { title: "Subterranean Dub #04", artist: "Basic Channel", album: "Phylyps Trak", genre: "Dub Techno", format: "WAV", size: "78.4 MB", peer: "detroit_dub", speed: "11.1 MB/s" },
    { title: "Halcyon + On + On", artist: "Orbital", album: "Orbital 2", genre: "Electronic", format: "FLAC", size: "54.8 MB", peer: "underground_uk", speed: "8.5 MB/s" },
    { title: "Alberto Balsalm", artist: "Aphex Twin", album: "...I Care Because You Do", genre: "Ambient Techno", format: "MP3", size: "11.6 MB", peer: "tokyo_peer", speed: "15.0 MB/s" },
    { title: "Blue Monday (80s 12'' Extended)", artist: "New Order", album: "Power, Corruption & Lies", genre: "Post-Punk", format: "FLAC", size: "71.2 MB", peer: "manchester_node", speed: "10.2 MB/s" }
  ];

  let currentFilter = 'all';

  function renderRows() {
    const query = searchInput.value.toLowerCase().trim();
    tableBody.innerHTML = '';

    const filtered = sampleTracks.filter(track => {
      const matchesQuery = !query || 
        track.title.toLowerCase().includes(query) ||
        track.artist.toLowerCase().includes(query) ||
        track.album.toLowerCase().includes(query) ||
        track.genre.toLowerCase().includes(query);

      const matchesFilter = 
        currentFilter === 'all' || 
        track.format.toLowerCase() === currentFilter.toLowerCase();

      return matchesQuery && matchesFilter;
    });

    if (filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">No sovereign peer shares found for "${query}"</td></tr>`;
      return;
    }

    filtered.forEach(track => {
      const formatClass = track.format === 'FLAC' ? 'format-flac' : (track.format === 'MP3' ? 'format-mp3' : 'format-wav');
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600; color: var(--text-primary);">${track.title}</td>
        <td style="color: var(--text-secondary);">${track.artist}</td>
        <td style="color: var(--text-muted);">${track.genre}</td>
        <td><span class="format-badge ${formatClass}">${track.format}</span></td>
        <td style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-muted);">${track.size}</td>
        <td style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--emerald-light);">${track.speed}</td>
      `;
      tableBody.appendChild(tr);
    });
  }

  searchInput.addEventListener('input', renderRows);

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.getAttribute('data-filter') || 'all';
      renderRows();
    });
  });

  renderRows();
}

// 4. Clipboard & Toast Notifications
function initCopyButtons() {
  const toast = document.getElementById('toast-notification');
  const toastText = document.getElementById('toast-text');

  function showToast(msg) {
    if (!toast || !toastText) return;
    toastText.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  const copyRadicaBtn = document.getElementById('copy-radica-btn');
  if (copyRadicaBtn) {
    copyRadicaBtn.addEventListener('click', () => {
      const textToCopy = '[📻 Spore Radio FM (Sovereign Dub)](spore:radio:freenet://USK@7xJ...spore_radio_stream)';
      copyToClipboard(textToCopy);
      showToast('📻 spore:radio link copied for Radica!');
    });
  }

  const copyContractBtn = document.getElementById('copy-contract-btn');
  if (copyContractBtn) {
    copyContractBtn.addEventListener('click', () => {
      const cmd = 'freenet publish --contract-type webapp docs/';
      copyToClipboard(cmd);
      showToast('📋 Freenet publish command copied!');
    });
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch (err) {
    console.error('Fallback copy failed', err);
  }
  document.body.removeChild(ta);
}

