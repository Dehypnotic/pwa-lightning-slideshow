const dropZone = document.getElementById("drop-zone");
const dropZoneMessage = dropZone.querySelector("p");
const defaultDropText = dropZoneMessage.textContent;
const fileInput = document.getElementById("file-input");
const selectFilesBtn = document.getElementById("select-files");
const startBtn = document.getElementById("start-slideshow");
const resetBtn = document.getElementById("reset-gallery");
const delayRange = document.getElementById("delay-range");
const delayInput = document.getElementById("delay-input");
const loader = document.getElementById("loader");
const stage = document.getElementById("stage");
const stageImage = document.getElementById("stage-image");

let imageEntries = [];
const imageSignatures = new Set();
let slideshowTimeout = null;
let slideshowRaf = null;
let currentIndex = 0;
let isRunning = false;

function revokeAll() {
  imageEntries.forEach(entry => URL.revokeObjectURL(entry.url));
}

function fileSignature(file) {
  return [file.name, file.type, file.size, file.lastModified].join("::");
}

function updateDropZoneMessage() {
  if (!imageEntries.length) {
    dropZoneMessage.textContent = defaultDropText;
  } else {
    dropZoneMessage.textContent = `${imageEntries.length} bilde${imageEntries.length === 1 ? '' : 'r'} klare.`;
  }
}

function addFiles(files) {
  if (!files || !files.length) {
    return;
  }

  const incoming = Array.from(files).filter(file => file.type.startsWith("image"));
  if (!incoming.length) {
    return;
  }

  let added = 0;
  incoming.forEach(file => {
    const signature = fileSignature(file);
    if (imageSignatures.has(signature)) {
      return;
    }
    const url = URL.createObjectURL(file);
    imageEntries.push({ file, url, signature });
    imageSignatures.add(signature);
    added += 1;
  });

  if (!added) {
    return;
  }

  updateDropZoneMessage();
  if (!isRunning) {
    startBtn.disabled = imageEntries.length === 0;
  }
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

function clearTimers() {
  if (slideshowTimeout) {
    clearTimeout(slideshowTimeout);
    slideshowTimeout = null;
  }

  if (slideshowRaf) {
    cancelAnimationFrame(slideshowRaf);
    slideshowRaf = null;
  }
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

  clearTimers();

  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function resetGallery() {
  stopSlideshow();
  clearTimers();
  revokeAll();
  imageEntries = [];
  imageSignatures.clear();
  currentIndex = 0;
  updateDropZoneMessage();
  startBtn.disabled = true;
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
    addFiles(files);
  }
});

selectFilesBtn.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("change", event => {
  const files = event.target.files;
  addFiles(files);
});

startBtn.addEventListener("click", startSlideshow);
resetBtn.addEventListener("click", resetGallery);

delayRange.addEventListener("input", syncDelayFromRange);
delayInput.addEventListener("input", syncDelayFromInput);

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    stopSlideshow();
  }
});

window.addEventListener("beforeunload", () => {
  revokeAll();
  imageEntries = [];
  imageSignatures.clear();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(err => {
      console.warn("Service worker registration failed", err);
    });
  });
}
