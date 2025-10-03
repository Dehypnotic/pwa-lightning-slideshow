const dropZone = document.getElementById("drop-zone");
const dropZoneMessage = dropZone.querySelector("p");
const defaultDropText = dropZoneMessage.textContent;
const fileInput = document.getElementById("file-input");
const selectFilesBtn = document.getElementById("select-files");
const startBtn = document.getElementById("start-slideshow");
const pasteBtn = document.getElementById("paste-clipboard");
const resetBtn = document.getElementById("reset-gallery");
const delayRange = document.getElementById("delay-range");
const delayInput = document.getElementById("delay-input");
const loader = document.getElementById("loader");
const stage = document.getElementById("stage");
const stageImage = document.getElementById("stage-image");

const pdfjsGlobal = typeof window !== "undefined" ? window.pdfjsLib : undefined;
const pdfSupported = Boolean(pdfjsGlobal);
if (pdfSupported) {
  pdfjsGlobal.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
} else {
  console.warn("PDF.js ble ikke lastet – PDF-støtte er deaktivert.");
}

let imageEntries = [];
const imageSignatures = new Set();
let slideshowTimeout = null;
let slideshowRaf = null;
let currentIndex = 0;
let isRunning = false;
let statusTimeout = null;

function revokeAll() {
  imageEntries.forEach(entry => URL.revokeObjectURL(entry.url));
}

function fileSignature(file) {
  return [file.name, file.type, file.size, file.lastModified].join("::");
}

function updateDropZoneMessage() {
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }

  if (!imageEntries.length) {
    dropZoneMessage.textContent = defaultDropText;
  } else {
    dropZoneMessage.textContent = `${imageEntries.length} bilde${imageEntries.length === 1 ? '' : 'r'} klare.`;
  }
}

function showStatus(message, revert = true, duration = 2400) {
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }

  dropZoneMessage.textContent = message;

  if (revert) {
    statusTimeout = setTimeout(() => {
      statusTimeout = null;
      updateDropZoneMessage();
    }, duration);
  }
}

function collectFilesFromDataTransfer(data) {
  if (!data) {
    return [];
  }

  const files = [];

  if (data.files && data.files.length) {
    files.push(...Array.from(data.files));
  }

  if (data.items && data.items.length) {
    Array.from(data.items)
      .filter(item => item.kind === "file")
      .forEach(item => {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      });
  }

  return files;
}

function addImageFile(file) {
  const signature = fileSignature(file);
  if (imageSignatures.has(signature)) {
    return 0;
  }
  const url = URL.createObjectURL(file);
  imageEntries.push({ url, signature, label: file.name || "Bilde" });
  imageSignatures.add(signature);
  return 1;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Kunne ikke opprette bilde fra PDF."));
      }
    }, "image/png");
  });
}

async function addPdfFile(file) {
  if (!pdfSupported) {
    return { added: 0, total: 0 };
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsGlobal.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  const total = pdfDoc.numPages;
  let added = 0;

  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const pageSignature = `${fileSignature(file)}::page${pageNumber}`;
      if (imageSignatures.has(pageSignature)) {
        continue;
      }

      let page;
      try {
        page = await pdfDoc.getPage(pageNumber);
      } catch (error) {
        console.warn(`Kunne ikke hente side ${pageNumber} fra ${file.name}`, error);
        continue;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const maxDimension = Math.max(baseViewport.width, baseViewport.height);
      const targetScale = Math.min(2.2, Math.max(1.2, 1400 / maxDimension));
      const viewport = page.getViewport({ scale: targetScale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      try {
        await page.render({ canvasContext: context, viewport }).promise;
      } catch (renderError) {
        console.warn(`Kunne ikke rendre side ${pageNumber} fra ${file.name}`, renderError);
        continue;
      }

      let blob;
      try {
        blob = await canvasToBlob(canvas);
      } catch (blobError) {
        console.warn(`Kunne ikke lagre side ${pageNumber} som bilde`, blobError);
        continue;
      }

      const url = URL.createObjectURL(blob);

      imageEntries.push({
        url,
        signature: pageSignature,
        label: `${file.name || "PDF"} – side ${pageNumber}`
      });
      imageSignatures.add(pageSignature);
      added += 1;
    }
  } finally {
    await pdfDoc.cleanup();
    await pdfDoc.destroy();
  }

  return { added, total };
}

async function addFiles(files) {
  if (!files || !files.length) {
    return { added: 0, supported: 0, unsupported: 0, pdfUnsupported: 0 };
  }

  const incoming = Array.from(files);
  let added = 0;
  let supported = 0;
  let unsupported = 0;
  let pdfUnsupported = 0;

  for (const file of incoming) {
    if (file.type.startsWith("image/")) {
      supported += 1;
      added += addImageFile(file);
      continue;
    }

    if (file.type === "application/pdf") {
      supported += 1;
      if (!pdfSupported) {
        pdfUnsupported += 1;
        continue;
      }

      showStatus(`Behandler ${file.name || "PDF"} …`, false, 6000);
      try {
        const { added: pagesAdded } = await addPdfFile(file);
        added += pagesAdded;
      } catch (error) {
        console.warn("Kunne ikke prosessere PDF", error);
        showStatus(`Klarte ikke å lese ${file.name || "PDF"}.`);
      }
      continue;
    }

    unsupported += 1;
  }

  if (added) {
    updateDropZoneMessage();
    if (!isRunning) {
      startBtn.disabled = imageEntries.length === 0;
    }
  } else if (!imageEntries.length) {
    updateDropZoneMessage();
    startBtn.disabled = true;
  }

  return { added, supported, unsupported, pdfUnsupported };
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
  stageImage.alt = entry.label || "Slideshow bilde";

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
  stageImage.removeAttribute("alt");

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

dropZone.addEventListener("drop", async event => {
  preventDefaults(event);
  dropZone.classList.remove("dragover");
  const files = collectFilesFromDataTransfer(event.dataTransfer);
  const result = await addFiles(files);
  const messages = [];
  if (result.added > 0) {
    messages.push(`La til ${result.added} bilde${result.added === 1 ? '' : 'r'}.`);
  }
  if (result.supported > 0 && result.added === 0 && !result.pdfUnsupported) {
    messages.push("Alt var allerede lagt til.");
  }
  if (result.pdfUnsupported > 0) {
    messages.push("PDF-støtte er ikke tilgjengelig i denne nettleseren.");
  }
  if (result.unsupported > 0) {
    messages.push(`Hoppet over ${result.unsupported} fil${result.unsupported === 1 ? '' : 'er'} uten støtte.`);
  }
  if (messages.length) {
    showStatus(messages.join(" "));
  } else {
    updateDropZoneMessage();
  }
});

selectFilesBtn.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("change", async event => {
  const files = event.target.files;
  const result = await addFiles(files);
  event.target.value = "";
  const messages = [];
  if (result.added > 0) {
    messages.push(`La til ${result.added} bilde${result.added === 1 ? '' : 'r'}.`);
  }
  if (result.supported > 0 && result.added === 0 && !result.pdfUnsupported) {
    messages.push("Ingen nye filer å legge til.");
  }
  if (result.pdfUnsupported > 0) {
    messages.push("PDF-støtte er ikke tilgjengelig i denne nettleseren.");
  }
  if (result.unsupported > 0) {
    messages.push(`Hoppet over ${result.unsupported} fil${result.unsupported === 1 ? '' : 'er'} uten støtte.`);
  }
  if (messages.length) {
    showStatus(messages.join(" "));
  } else {
    updateDropZoneMessage();
  }
});

startBtn.addEventListener("click", startSlideshow);
resetBtn.addEventListener("click", resetGallery);

delayRange.addEventListener("input", syncDelayFromRange);
delayInput.addEventListener("input", syncDelayFromInput);

document.addEventListener("paste", async event => {
  const files = collectFilesFromDataTransfer(event.clipboardData);
  if (!files.length) {
    return;
  }
  event.preventDefault();
  const result = await addFiles(files);
  const messages = [];
  if (result.added > 0) {
    messages.push(`La til ${result.added} bilde${result.added === 1 ? '' : 'r'} fra utklippstavlen.`);
  }
  if (result.supported > 0 && result.added === 0 && !result.pdfUnsupported) {
    messages.push("Alt fra utklippstavlen er allerede lagt til.");
  }
  if (result.pdfUnsupported > 0) {
    messages.push("PDF-støtte er ikke tilgjengelig i denne nettleseren.");
  }
  if (result.unsupported > 0) {
    messages.push(`Utklippstavlen inneholdt ${result.unsupported} fil${result.unsupported === 1 ? '' : 'er'} uten støtte.`);
  }
  showStatus(messages.join(" ") || "Fant ingen støttede filer i utklippstavlen.");
});

if (pasteBtn) {
  const clipboardReadSupported = !!(navigator.clipboard && navigator.clipboard.read);
  if (!clipboardReadSupported) {
    pasteBtn.disabled = true;
    pasteBtn.title = "Utklippstavle-lesing støttes ikke i denne nettleseren.";
  } else {
    pasteBtn.addEventListener("click", async () => {
      try {
        const items = await navigator.clipboard.read();
        const clipboardFiles = [];
        let index = 0;
        for (const item of items) {
          for (const type of item.types) {
            const isImage = type.startsWith("image/");
            const isPdf = type === "application/pdf";
            if (!isImage && !isPdf) {
              continue;
            }
            const blob = await item.getType(type);
            const extension = isPdf ? "pdf" : (type.split("/")[1] || "png");
            const file = new File([blob], `clipboard-${Date.now()}-${index}.${extension}`, {
              type: blob.type,
              lastModified: Date.now()
            });
            clipboardFiles.push(file);
            index += 1;
          }
        }

        if (!clipboardFiles.length) {
          showStatus("Fant ingen støttede filer i utklippstavlen.");
          return;
        }

        const result = await addFiles(clipboardFiles);
        const messages = [];
        if (result.added > 0) {
          messages.push(`La til ${result.added} bilde${result.added === 1 ? '' : 'r'} fra utklippstavlen.`);
        }
        if (result.supported > 0 && result.added === 0 && !result.pdfUnsupported) {
          messages.push("Alt fra utklippstavlen er allerede lagt til.");
        }
        if (result.pdfUnsupported > 0) {
          messages.push("PDF-støtte er ikke tilgjengelig i denne nettleseren.");
        }
        if (result.unsupported > 0) {
          messages.push(`Utklippstavlen inneholdt ${result.unsupported} fil${result.unsupported === 1 ? '' : 'er'} uten støtte.`);
        }
        showStatus(messages.join(" ") || "Fant ingen støttede filer i utklippstavlen.");
      } catch (err) {
        console.warn("Kunne ikke lese utklippstavlen", err);
        showStatus("Kunne ikke lese utklippstavlen. Tillat tilgang og prøv igjen.");
      }
    });
  }
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    stopSlideshow();
  }
});

window.addEventListener("beforeunload", () => {
  revokeAll();
  imageEntries = [];
  imageSignatures.clear();
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = null;
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(err => {
      console.warn("Service worker registration failed", err);
    });
  });
}
