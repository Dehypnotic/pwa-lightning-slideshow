const dropZone = document.getElementById("drop-zone");
const dropZoneMessage = dropZone.querySelector("p");
const defaultDropText = dropZoneMessage.textContent;
const fileInput = document.getElementById("file-input");
const selectFilesBtn = document.getElementById("select-files");
const startBtn = document.getElementById("start-slideshow");
const delayRange = document.getElementById("delay-range");
const delayInput = document.getElementById("delay-input");
const loader = document.getElementById("loader");
const stage = document.getElementById("stage");
const stageImage = document.getElementById("stage-image");

let imageEntries = [];
let slideshowTimeout = null;
let slideshowRaf = null;
let currentIndex = 0;
let isRunning = false;

function revokeAll() {
  imageEntries.forEach(entry => URL.revokeObjectURL(entry.url));
}

function handleFiles(files) {
  if (!files || !files.length) {
    return;
  }

  revokeAll();
  imageEntries = Array.from(files)
    .filter(file => file.type.startsWith("image"))
    .map(file => ({ file, url: URL.createObjectURL(file) }));

  if (!imageEntries.length) {
    startBtn.disabled = true;
    dropZoneMessage.textContent = defaultDropText;
    return;
  }

  dropZoneMessage.textContent = `${imageEntries.length} bilde${imageEntries.length === 1 ? '' : 'r'} klare.`;
  startBtn.disabled = false;
}

function syncDelayFromRange() {
  delayInput.value = delayRange.value;
}

function syncDelayFromInput() {
  const value = Number(delayInput.value);
  if (Number.isNaN(value)) {
    delayInput.value = delayRange.value;
    return;
  }
  const clamped = Math.min(2000, Math.max(0, value));
  delayInput.value = clamped;
  delayRange.value = clamped;
}

function scheduleNextFrame() {
  const delay = Number(delayRange.value);
  if (delay <= 0) {
    slideshowRaf = requestAnimationFrame(showNextImage);
  } else {
    slideshowTimeout = setTimeout(showNextImage, delay);
  }
}

function showNextImage() {
  if (!isRunning) {
    return;
  }

  if (!imageEntries.length) {
    stopSlideshow();
    return;
  }

  const entry = imageEntries[currentIndex];
  stageImage.src = entry.url;

  currentIndex = (currentIndex + 1) % imageEntries.length;
  scheduleNextFrame();
}

async function startSlideshow() {
  if (isRunning || !imageEntries.length) {
    return;
  }

  isRunning = true;
  currentIndex = 0;
  startBtn.disabled = true;
  loader.classList.add("hidden");
  stage.classList.remove("hidden");

  try {
    if (stage.requestFullscreen && !document.fullscreenElement) {
      await stage.requestFullscreen();
    }
  } catch (err) {
    // Fullscreen might be blocked; continue regardless.
    console.warn("Fullscreen request failed", err);
  }

  showNextImage();
}

function stopSlideshow() {
  if (!isRunning) {
    return;
  }

  isRunning = false;
  startBtn.disabled = imageEntries.length === 0;
  loader.classList.remove("hidden");
  stage.classList.add("hidden");
  stageImage.removeAttribute("src");

  if (slideshowTimeout) {
    clearTimeout(slideshowTimeout);
    slideshowTimeout = null;
  }

  if (slideshowRaf) {
    cancelAnimationFrame(slideshowRaf);
    slideshowRaf = null;
  }

  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function preventDefaults(event) {
  event.preventDefault();
  event.stopPropagation();
}

dropZone.addEventListener("dragenter", event => {
  preventDefaults(event);
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragover", preventDefaults);

dropZone.addEventListener("dragleave", event => {
  preventDefaults(event);
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", event => {
  preventDefaults(event);
  dropZone.classList.remove("dragover");
  const files = event.dataTransfer?.files;
  if (files) {
    handleFiles(files);
  }
});

selectFilesBtn.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("change", event => {
  const files = event.target.files;
  handleFiles(files);
});

startBtn.addEventListener("click", startSlideshow);

delayRange.addEventListener("input", syncDelayFromRange);
delayInput.addEventListener("input", syncDelayFromInput);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    stopSlideshow();
  }
});

window.addEventListener("beforeunload", revokeAll);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(err => {
      console.warn("Service worker registration failed", err);
    });
  });
}
