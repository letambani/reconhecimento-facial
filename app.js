(function () {
  "use strict";

  var btnRecheckServer = document.getElementById("btnRecheckServer");
  var tabFile = document.getElementById("tabFile");
  var tabCam = document.getElementById("tabCam");
  var paneFile = document.getElementById("paneFile");
  var paneCam = document.getElementById("paneCam");
  var fileInput = document.getElementById("fileInput");
  var fileLabel = document.getElementById("fileLabel");
  var video = document.getElementById("video");
  var camHint = document.getElementById("camHint");
  var btnStartCam = document.getElementById("btnStartCam");
  var btnStopCam = document.getElementById("btnStopCam");
  var previewCanvas = document.getElementById("previewCanvas");
  var previewEmpty = document.getElementById("previewEmpty");
  var optLearn = document.getElementById("optLearn");
  var btnCapture = document.getElementById("btnCapture");
  var btnReset = document.getElementById("btnReset");
  var btnNovaConsulta = document.getElementById("btnNovaConsulta");
  var faceOverlay = document.getElementById("faceOverlay");
  var faceBox = document.getElementById("faceBox");
  var faceTag = document.getElementById("faceTag");
  var resultStrip = document.getElementById("resultStrip");
  var resultThumb = document.getElementById("resultThumb");
  var resultName = document.getElementById("resultName");
  var resultConf = document.getElementById("resultConf");
  var resultBadge = document.getElementById("resultBadge");
  var btnCadastroRapido = document.getElementById("btnCadastroRapido");
  var modal = document.getElementById("modal");
  var formQuick = document.getElementById("formQuick");
  var pillServer = document.getElementById("pillServer");
  var pillText = document.getElementById("pillText");

  var previewCtx = previewCanvas.getContext("2d");

  var lastBlobForApi = null;
  var savedFileBlob = null;
  var savedFileLabel = "";
  /** @type {'file' | 'cam'} */
  var activeSource = "file";
  var stream = null;
  var rafId = 0;

  var MAX_PREVIEW_W = 640;
  var MAX_PREVIEW_H = 480;

  /** Caminho do app (vazio em localhost na raiz; /repo em github.io/repo/). */
  function appBasePath() {
    var p = window.location.pathname.replace(/\/$/, "") || "/";
    if (p.endsWith("/index.html")) {
      p = p.slice(0, -"/index.html".length) || "/";
    }
    return p === "/" ? "" : p;
  }

  function apiUrl(path) {
    return appBasePath() + path;
  }

  function isGitHubPages() {
    return /\.github\.io$/i.test(window.location.hostname);
  }

  function isHttpPage() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  function setBlockServer(show) {
    document.getElementById("blockServer").hidden = !show;
  }

  function hideFaceOverlay() {
    faceOverlay.hidden = true;
  }

  function syncFaceOverlay(rosto, imagem, label, identified) {
    if (!rosto || !imagem) return;
    var iw = imagem.largura;
    var ih = imagem.altura;
    var cw = previewCanvas.width;
    var ch = previewCanvas.height;
    var kx = cw / iw;
    var ky = ch / ih;
    var dispW = previewCanvas.clientWidth || cw;
    var dispH = previewCanvas.clientHeight || ch;
    var sx = dispW / cw;
    var sy = dispH / ch;
    faceBox.style.left = rosto.x * kx * sx + "px";
    faceBox.style.top = rosto.y * ky * sy + "px";
    faceBox.style.width = rosto.w * kx * sx + "px";
    faceBox.style.height = rosto.h * ky * sy + "px";
    faceOverlay.style.width = dispW + "px";
    faceOverlay.style.height = dispH + "px";
    faceTag.textContent = label;
    faceBox.classList.toggle("face-box--warn", !identified);
    faceOverlay.hidden = false;
  }

  function hideResultStrip() {
    resultStrip.hidden = true;
    btnNovaConsulta.hidden = true;
    resultThumb.hidden = true;
    btnCadastroRapido.hidden = true;
    resultStrip.classList.remove("result-strip--warn");
  }

  function showResultIdentified(p, pct) {
    resultStrip.classList.remove("result-strip--warn");
    resultThumb.hidden = false;
    resultThumb.src =
      apiUrl("/api/pessoa/" + encodeURIComponent(p.id) + "/avatar") + "?t=" + Date.now();
    resultName.textContent = p.nome;
    resultConf.textContent = "Confiança: " + pct + "%";
    resultBadge.textContent = "IDENTIFICADO";
    resultBadge.style.display = "";
    btnCadastroRapido.hidden = true;
    resultStrip.hidden = false;
    btnNovaConsulta.hidden = false;
  }

  function showResultUnknown() {
    resultStrip.classList.add("result-strip--warn");
    resultThumb.hidden = true;
    resultName.textContent = "Não identificado no acervo";
    resultConf.textContent = "Tente outro ângulo ou cadastre a pessoa.";
    resultBadge.textContent = "PENDENTE";
    btnCadastroRapido.hidden = false;
    resultStrip.hidden = false;
    btnNovaConsulta.hidden = false;
  }

  function clearConsultaVisual() {
    hideFaceOverlay();
    hideResultStrip();
  }

  function showPreviewEmpty() {
    previewEmpty.hidden = false;
    previewCanvas.style.visibility = "hidden";
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  }

  function drawSourceToCanvas(source) {
    var w = source.videoWidth || source.naturalWidth || source.width;
    var h = source.videoHeight || source.naturalHeight || source.height;
    if (!w || !h) return;
    var scale = Math.min(MAX_PREVIEW_W / w, MAX_PREVIEW_H / h, 1);
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    previewCanvas.width = cw;
    previewCanvas.height = ch;
    previewCtx.drawImage(source, 0, 0, cw, ch);
    previewEmpty.hidden = true;
    previewCanvas.style.visibility = "visible";
  }

  function drawBlobToCanvas(blob) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(blob);
      img.onload = function () {
        URL.revokeObjectURL(url);
        drawSourceToCanvas(img);
        resolve();
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Imagem inválida."));
      };
      img.src = url;
    });
  }

  function stopPreviewLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function startPreviewLoop() {
    stopPreviewLoop();
    function tick() {
      if (activeSource === "cam" && stream && video.readyState >= 2) {
        drawSourceToCanvas(video);
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function stopCamera() {
    stopPreviewLoop();
    if (stream) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    btnStopCam.hidden = true;
    camHint.textContent = "Webcam desligada.";
  }

  function invalidateCaptureButton() {
    if (isGitHubPages()) {
      btnCapture.disabled = true;
      return;
    }
    var ok =
      isHttpPage() &&
      ((activeSource === "file" && lastBlobForApi !== null) ||
        (activeSource === "cam" && stream !== null && video.videoWidth > 0));
    btnCapture.disabled = !ok;
  }

  function handleFile(blob, name) {
    if (!blob || !blob.type.match(/^image\//)) {
      alert("Escolha JPG ou PNG.");
      return;
    }
    lastBlobForApi = blob;
    savedFileBlob = blob;
    savedFileLabel = name || "foto";
    fileLabel.hidden = false;
    fileLabel.textContent = "Arquivo: " + savedFileLabel;
    var img = new Image();
    var url = URL.createObjectURL(blob);
    img.onload = function () {
      URL.revokeObjectURL(url);
      drawSourceToCanvas(img);
      hideFaceOverlay();
      hideResultStrip();
      invalidateCaptureButton();
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      alert("Não foi possível ler a imagem.");
    };
    img.src = url;
  }

  function setMode(fileMode) {
    clearConsultaVisual();
    if (fileMode) {
      tabFile.classList.add("tool--on");
      tabCam.classList.remove("tool--on");
      paneFile.hidden = false;
      paneCam.hidden = true;
      activeSource = "file";
      stopCamera();
      if (savedFileBlob) {
        lastBlobForApi = savedFileBlob;
        fileLabel.hidden = false;
        fileLabel.textContent = "Arquivo: " + savedFileLabel;
        var imgA = new Image();
        var urlA = URL.createObjectURL(savedFileBlob);
        imgA.onload = function () {
          URL.revokeObjectURL(urlA);
          drawSourceToCanvas(imgA);
          invalidateCaptureButton();
        };
        imgA.src = urlA;
      } else if (lastBlobForApi && !savedFileBlob) {
        fileLabel.hidden = false;
        fileLabel.textContent = "Última captura";
        drawBlobToCanvas(lastBlobForApi).then(invalidateCaptureButton);
      } else {
        lastBlobForApi = null;
        fileLabel.hidden = true;
        showPreviewEmpty();
      }
    } else {
      tabCam.classList.add("tool--on");
      tabFile.classList.remove("tool--on");
      paneFile.hidden = true;
      paneCam.hidden = false;
      activeSource = "cam";
      fileLabel.hidden = true;
      showPreviewEmpty();
      camHint.textContent = 'Clique em "Ligar webcam".';
    }
    invalidateCaptureButton();
  }

  async function startCamera() {
    try {
      camHint.textContent = "Solicitando permissão…";
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      video.hidden = true;
      btnStopCam.hidden = false;
      await video.play().catch(function () {});
      video.addEventListener(
        "loadeddata",
        function once() {
          video.removeEventListener("loadeddata", once);
          camHint.textContent = "Enquadre o rosto e toque em CAPTURAR.";
          lastBlobForApi = null;
          startPreviewLoop();
          invalidateCaptureButton();
        },
        { once: true }
      );
    } catch (e) {
      camHint.textContent = "Webcam indisponível.";
      alert('Permita a câmera ou use o modo ARQUIVO com uma foto JPG.');
      invalidateCaptureButton();
    }
  }

  function blobFromVideoFrame() {
    var w = video.videoWidth;
    var h = video.videoHeight;
    if (!w || !h) throw new Error("Aguarde a webcam.");
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(video, 0, 0);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) {
        if (b) resolve(b);
        else reject(new Error("Falha ao capturar."));
      }, "image/jpeg", 0.92);
    });
  }

  async function getBlobForSearch() {
    if (activeSource === "file") {
      if (!lastBlobForApi) throw new Error("Selecione um arquivo.");
      return lastBlobForApi;
    }
    return blobFromVideoFrame();
  }

  async function refreshPill() {
    pillServer.classList.remove("is-ok", "is-bad");
    if (!isHttpPage()) {
      pillText.textContent = "use o endereço http";
      pillServer.classList.add("is-bad");
      return false;
    }
    if (isGitHubPages()) {
      pillText.textContent = "Demo visual — API: clone e ./run.sh";
      pillServer.classList.add("is-bad");
      return false;
    }
    try {
      var r = await fetch(apiUrl("/api/status"), { cache: "no-store" });
      if (!r.ok) throw new Error();
      var j = await r.json();
      pillText.textContent = "Acervo: " + j.cadastros + " cadastro(s)";
      pillServer.classList.add("is-ok");
      return true;
    } catch (e) {
      pillText.textContent = "offline — ./run.sh";
      pillServer.classList.add("is-bad");
      return false;
    }
  }

  async function checkServerGate() {
    if (!isHttpPage()) {
      setBlockServer(true);
      await refreshPill();
      return false;
    }
    if (isGitHubPages()) {
      setBlockServer(false);
      await refreshPill();
      return false;
    }
    var ok = await refreshPill();
    if (!ok) {
      setBlockServer(true);
      return false;
    }
    setBlockServer(false);
    return true;
  }

  async function runCapture() {
    var gateOk = await checkServerGate();
    if (!gateOk) {
      if (isGitHubPages()) {
        alert(
          "No GitHub Pages só há a interface estática.\n\nPara reconhecimento facial, clone o repositório no seu computador e execute ./run.sh."
        );
      }
      return;
    }
    btnCapture.disabled = true;
    hideFaceOverlay();

    try {
      var blob = await getBlobForSearch();
      await drawBlobToCanvas(blob);
      lastBlobForApi = blob;
      stopPreviewLoop();

      var fd = new FormData();
      fd.append("foto", blob, "captura.jpg");
      fd.append("aprender", optLearn.checked ? "true" : "false");

      var res = await fetch(apiUrl("/api/identificar"), { method: "POST", body: fd });
      var data = await res.json().catch(function () {
        return {};
      });

      if (!res.ok) {
        var detail = data.detail;
        var msg =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.map(function (d) {
                  return d.msg;
                }).join(" ")
            : "Erro na consulta.";
        alert(msg);
        hideResultStrip();
        return;
      }

      var rosto = data.rosto;
      var imagem = data.imagem;

      if (data.reconhecido && data.pessoa) {
        var pct =
          data.confianca_exibicao_pct != null
            ? data.confianca_exibicao_pct
            : 60;
        var label = data.pessoa.nome + " (" + pct + "%)";
        requestAnimationFrame(function () {
          syncFaceOverlay(rosto, imagem, label, true);
        });
        showResultIdentified(data.pessoa, pct);
      } else {
        requestAnimationFrame(function () {
          syncFaceOverlay(rosto, imagem, "Rosto detectado", false);
        });
        showResultUnknown();
      }
    } catch (e) {
      alert(e.message || String(e));
      hideResultStrip();
    } finally {
      btnCapture.disabled = false;
      invalidateCaptureButton();
      refreshPill();
    }
  }

  function novaConsulta() {
    clearConsultaVisual();
    if (activeSource === "file" && savedFileBlob) {
      handleFile(savedFileBlob, savedFileLabel);
    } else if (activeSource === "cam" && stream) {
      startPreviewLoop();
      invalidateCaptureButton();
    } else {
      showPreviewEmpty();
      lastBlobForApi = savedFileBlob;
      invalidateCaptureButton();
    }
  }

  function showModal(show) {
    modal.hidden = !show;
    if (show && formQuick.nome) formQuick.nome.focus();
  }

  document.querySelectorAll("[data-close-modal]").forEach(function (el) {
    el.addEventListener("click", function () {
      showModal(false);
    });
  });

  tabFile.addEventListener("click", function () {
    setMode(true);
  });
  tabCam.addEventListener("click", function () {
    setMode(false);
  });

  paneFile.addEventListener("click", function () {
    fileInput.click();
  });
  paneFile.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", function () {
    var f = fileInput.files && fileInput.files[0];
    if (f) handleFile(f, f.name);
  });
  paneFile.addEventListener("dragover", function (e) {
    e.preventDefault();
  });
  paneFile.addEventListener("drop", function (e) {
    e.preventDefault();
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f, f.name);
  });

  btnStartCam.addEventListener("click", function () {
    startCamera();
  });
  btnStopCam.addEventListener("click", function () {
    stopCamera();
    showPreviewEmpty();
    invalidateCaptureButton();
  });

  btnCapture.addEventListener("click", runCapture);
  btnReset.addEventListener("click", function () {
    novaConsulta();
  });
  btnNovaConsulta.addEventListener("click", function () {
    novaConsulta();
  });
  btnCadastroRapido.addEventListener("click", function () {
    showModal(true);
  });

  btnRecheckServer.addEventListener("click", function () {
    checkServerGate();
  });

  formQuick.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    if (!lastBlobForApi) {
      alert("Capture ou escolha uma imagem antes.");
      return;
    }
    var fd = new FormData(formQuick);
    fd.append("foto", lastBlobForApi, "cadastro.jpg");
    var btn = formQuick.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      var res = await fetch(apiUrl("/api/cadastro-rapido"), { method: "POST", body: fd });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        var detail = data.detail;
        var msg =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.map(function (d) {
                  return d.msg;
                }).join(" ")
            : "Erro ao salvar.";
        alert(msg);
        return;
      }
      showModal(false);
      formQuick.reset();
      var p = data.pessoa;
      showResultIdentified(p, 100);
      resultBadge.textContent = "CADASTRADO";
      hideFaceOverlay();
      refreshPill();
    } finally {
      btn.disabled = false;
    }
  });

  showPreviewEmpty();
  setMode(true);
  checkServerGate();
})();
