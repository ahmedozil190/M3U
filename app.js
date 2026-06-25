// Global State
let channels = [];
let filteredChannels = [];
let categories = new Set();
let currentHls = null;
let currentMpegtsPlayer = null;

// DOM Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const pasteInput = document.getElementById('paste-input');
const btnParseText = document.getElementById('btn-parse-text');
const urlInput = document.getElementById('url-input');
const btnParseUrl = document.getElementById('btn-parse-url');

const statTotal = document.getElementById('stat-total');
const statSports = document.getElementById('stat-sports');

const videoPlayer = document.getElementById('video-player');
const playerPlaceholder = document.getElementById('player-placeholder');
const playerInfo = document.getElementById('player-info');
const playingLogo = document.getElementById('playing-logo');
const playingName = document.getElementById('playing-name');
const playingGroup = document.getElementById('playing-group');
const playingUrl = document.getElementById('playing-url');
const btnCopyPlaying = document.getElementById('btn-copy-playing');
const streamStatus = document.getElementById('stream-status');
const useProxyCheckbox = document.getElementById('use-proxy');

const searchInput = document.getElementById('search-input');
const groupFilter = document.getElementById('group-filter');
const channelsContainer = document.getElementById('channels-container');
const toast = document.getElementById('toast');

// Initialize Tabs
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        const tabId = `tab-${btn.dataset.tab}`;
        document.getElementById(tabId).classList.add('active');
    });
});

// Drag and Drop File Upload
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

// Parse Text Paste
btnParseText.addEventListener('click', () => {
    const text = pasteInput.value.trim();
    if (!text) {
        showToast('الرجاء لصق نص M3U أولاً!', true);
        return;
    }
    processM3UContent(text);
});

// Parse URL
btnParseUrl.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
        showToast('الرجاء إدخال رابط صالح!', true);
        return;
    }
    
    showToast('جاري تحميل الملف...');
    try {
        // Note: browser might block this due to CORS. In a real-world scenario we need a proxy, but we handle the error gracefully.
        const response = await fetch(url);
        if (!response.ok) throw new Error('فشل تحميل الملف');
        const text = await response.text();
        processM3UContent(text);
    } catch (err) {
        console.error(err);
        showToast('فشل في جلب الرابط بسبب سياسة الحماية (CORS). يرجى تحميل الملف يدوياً ولصقه.', true);
    }
});

// File Handling
function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        processM3UContent(e.target.result);
    };
    reader.readAsText(file);
}

// Core M3U Parsing Algorithm
function processM3UContent(content) {
    channels = [];
    categories.clear();
    
    const lines = content.split(/\r?\n/);
    let currentChannel = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line.toUpperCase().startsWith('#EXTINF:')) {
            currentChannel = {};
            
            // Extract Logo (tvg-logo)
            const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
            currentChannel.logo = logoMatch ? logoMatch[1] : '';

            // Extract Category/Group (group-title)
            const groupMatch = line.match(/group-title="([^"]*)"/i);
            currentChannel.group = groupMatch ? groupMatch[1] : 'غير مصنف';
            categories.add(currentChannel.group);

            // Extract Channel Name (after last comma)
            const lastComma = line.lastIndexOf(',');
            if (lastComma !== -1) {
                currentChannel.name = line.substring(lastComma + 1).trim();
            } else {
                const nameMatch = line.match(/tvg-name="([^"]*)"/i);
                currentChannel.name = nameMatch ? nameMatch[1] : 'قناة غير معروفة';
            }
        } else if (!line.startsWith('#')) {
            // It's a stream URL
            if (currentChannel) {
                currentChannel.url = line;
                channels.push(currentChannel);
                currentChannel = null; // Reset for next channel
            }
        }
    }

    if (channels.length === 0) {
        showToast('لم يتم العثور على قنوات صالحة في الملف!', true);
        return;
    }

    showToast(`تم استيراد ${channels.length} قناة بنجاح!`);
    updateStats();
    populateGroupFilter();
    applyFilters();
}

// Update Statistics
function updateStats() {
    statTotal.textContent = channels.length;
    
    // Count sport channels
    const sportsKeywords = ['sport', 'bein', 'sports', 'رياضة', 'كورة', 'دوري', 'كأس', 'tvg-logo="http'];
    const sportsCount = channels.filter(c => {
        const nameLower = c.name.toLowerCase();
        const groupLower = c.group.toLowerCase();
        return sportsKeywords.some(keyword => nameLower.includes(keyword) || groupLower.includes(keyword));
    }).length;
    
    statSports.textContent = sportsCount;
}

// Populate Category Dropdown
function populateGroupFilter() {
    groupFilter.innerHTML = '<option value="">جميع الأقسام</option>';
    const sortedCategories = Array.from(categories).sort();
    sortedCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        groupFilter.appendChild(option);
    });
}

// Filters & Search
searchInput.addEventListener('input', applyFilters);
groupFilter.addEventListener('change', applyFilters);

function applyFilters() {
    const searchQuery = searchInput.value.toLowerCase().trim();
    const selectedGroup = groupFilter.value;

    filteredChannels = channels.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchQuery) || c.group.toLowerCase().includes(searchQuery);
        const matchesGroup = !selectedGroup || c.group === selectedGroup;
        return matchesSearch && matchesGroup;
    });

    renderChannels();
}

// Render Channels List
function renderChannels() {
    channelsContainer.innerHTML = '';
    
    if (filteredChannels.length === 0) {
        channelsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-circle-xmark"></i>
                <h3>لم يتم العثور على أي قناة مطابقة</h3>
                <p>يرجى تعديل خيارات البحث أو تصفية الأقسام.</p>
            </div>
        `;
        return;
    }

    filteredChannels.forEach(chan => {
        const row = document.createElement('div');
        row.className = 'channel-row';
        
        // Channel logo fallback image
        const logoUrl = chan.logo || 'https://placehold.co/100x100/1e1e2e/ffffff?text=TV';
        
        row.innerHTML = `
            <div class="channel-logo-col">
                <img src="${logoUrl}" alt="${chan.name}" onerror="this.src='https://placehold.co/100x100/1e1e2e/ffffff?text=TV'">
            </div>
            <div class="channel-name-col" title="${chan.name}">${chan.name}</div>
            <div class="channel-group-col" title="${chan.group}">${chan.group}</div>
            <div class="channel-actions-col">
                <button class="btn btn-secondary btn-copy" data-url="${chan.url}"><i class="fa-solid fa-copy"></i> نسخ</button>
                <button class="btn btn-primary btn-play" data-url="${chan.url}" data-name="${chan.name}" data-group="${chan.group}" data-logo="${logoUrl}"><i class="fa-solid fa-play"></i> تشغيل</button>
            </div>
        `;
        
        channelsContainer.appendChild(row);
    });

    // Copy event listener
    document.querySelectorAll('.btn-copy').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            copyToClipboard(btn.dataset.url);
        });
    });

    // Play event listener
    document.querySelectorAll('.btn-play').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Remove active style from all rows
            document.querySelectorAll('.channel-row').forEach(r => r.classList.remove('playing'));
            
            // Add to parent row
            btn.closest('.channel-row').classList.add('playing');
            
            playStream(btn.dataset.url, btn.dataset.name, btn.dataset.group, btn.dataset.logo);
        });
    });
}

// Clipboard copying utility
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('تم نسخ رابط القناة بنجاح!');
    }).catch(err => {
        console.error('فشل النسخ: ', err);
        showToast('عذراً، فشل نسخ الرابط.', true);
    });
}

// Toast System
function showToast(message, isError = false) {
    toast.textContent = message;
    toast.style.backgroundColor = isError ? 'var(--danger-color)' : 'var(--success-color)';
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Play Live Stream with Hls.js or Mpegts.js
function playStream(url, name, group, logo) {
    // Show player elements, hide placeholder
    playerPlaceholder.style.display = 'none';
    playerInfo.style.display = 'flex';
    
    // Check if we should use proxy
    const useProxy = useProxyCheckbox ? useProxyCheckbox.checked : false;
    const proxyBase = window.location.origin.startsWith('http') ? window.location.origin : 'http://localhost:3000';
    const playUrl = useProxy ? `${proxyBase}/proxy?url=${encodeURIComponent(url)}` : url;
    
    // Set meta
    playingLogo.src = logo;
    playingName.textContent = name;
    playingGroup.textContent = group;
    playingUrl.value = playUrl;
    
    btnCopyPlaying.onclick = () => copyToClipboard(playUrl);

    // Stop and clean up current Hls instance
    if (currentHls) {
        currentHls.destroy();
        currentHls = null;
    }

    // Stop and clean up current Mpegts instance
    if (currentMpegtsPlayer) {
        currentMpegtsPlayer.unload();
        currentMpegtsPlayer.detachMediaElement();
        currentMpegtsPlayer.destroy();
        currentMpegtsPlayer = null;
    }

    // Reset video element src
    videoPlayer.src = '';
    videoPlayer.removeAttribute('src');
    videoPlayer.load();

    streamStatus.textContent = 'جاري الاتصال...';
    streamStatus.className = 'badge badge-live';

    const isHls = url.toLowerCase().includes('m3u8');

    // 1. Play HLS Streams (.m3u8) using Hls.js
    if (isHls) {
        if (Hls.isSupported()) {
            currentHls = new Hls({
                maxMaxBufferLength: 10,
                enableWorker: true
            });
            currentHls.loadSource(playUrl);
            currentHls.attachMedia(videoPlayer);
            
            currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
                videoPlayer.play().catch(err => console.log("Autoplay blocked:", err));
                streamStatus.textContent = 'مباشر (HLS)';
                streamStatus.className = 'badge badge-live playing';
            });
            
            currentHls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.error('Network error playing stream:', data);
                            streamStatus.textContent = 'خطأ في الشبكة';
                            currentHls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.error('Media error playing stream:', data);
                            streamStatus.textContent = 'خطأ في فك التشفير';
                            currentHls.recoverMediaError();
                            break;
                        default:
                            console.error('Fatal player error:', data);
                            streamStatus.textContent = 'فشل التشغيل';
                            currentHls.destroy();
                            break;
                    }
                }
            });
        } 
        // Native HLS support (Safari)
        else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = playUrl;
            videoPlayer.addEventListener('loadedmetadata', () => {
                videoPlayer.play().catch(err => console.log("Autoplay blocked:", err));
                streamStatus.textContent = 'مباشر (Native)';
                streamStatus.className = 'badge badge-live playing';
            });
            videoPlayer.addEventListener('error', () => {
                streamStatus.textContent = 'فشل التشغيل';
            });
        } else {
            streamStatus.textContent = 'المتصفح لا يدعم بث HLS';
            showToast('متصفحك لا يدعم تشغيل بث HLS المباشر.', true);
        }
    } 
    // 2. Play TS and other formats using Mpegts.js (IPTV links are mostly TS format)
    else {
        if (mpegts.getFeatureList().mseLivePlayback) {
            currentMpegtsPlayer = mpegts.createPlayer(
                {
                    type: 'mpegts',
                    isLive: true,
                    url: playUrl,
                    hasAudio: true,
                    hasVideo: true,
                    cors: true,
                    withCredentials: false
                },
                {
                    enableWorker: false,
                    lazyLoad: false,
                    liveBufferLatencyChasing: true,
                    liveBufferLatencyMaxLatency: 10,
                    liveBufferLatencyMinRemain: 0.5,
                    fixAudioTimestampGap: true
                }
            );
            currentMpegtsPlayer.attachMediaElement(videoPlayer);
            currentMpegtsPlayer.load();
            currentMpegtsPlayer.play().then(() => {
                streamStatus.textContent = 'مباشر (MPEG-TS)';
                streamStatus.className = 'badge badge-live playing';
            }).catch(err => {
                console.warn('Mpegts playback failed, attempting direct HTML5 video play:', err);
                tryDirectPlay(playUrl);
            });

            currentMpegtsPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
                console.error('Mpegts error:', errType, errDetail);
                if (errType === mpegts.ErrorTypes.NETWORK_ERROR) {
                    streamStatus.textContent = 'خطأ شبكة TS';
                } else if (errType === mpegts.ErrorTypes.MEDIA_ERROR) {
                    streamStatus.textContent = 'خطأ فك ترميز TS';
                }
            });
        } else {
            tryDirectPlay(playUrl);
        }
    }
}

// Fallback to direct native browser playback
function tryDirectPlay(playUrl) {
    videoPlayer.src = playUrl;
    videoPlayer.play().then(() => {
        streamStatus.textContent = 'مباشر (Direct)';
        streamStatus.className = 'badge badge-live playing';
    }).catch(err => {
        console.error('Direct play error:', err);
        streamStatus.textContent = 'فشل التشغيل';
        const isProxy = useProxyCheckbox && useProxyCheckbox.checked;
        if (!isProxy) {
            showToast('فشل التشغيل. حاول تفعيل "الخادم الوسيط (CORS Proxy)" ثم أعد المحاولة.', true);
        } else {
            showToast('فشل تشغيل القناة. قد يكون الرابط محجوباً أو منتهي الصلاحية.', true);
        }
    });
}
