"use strict";

const root = document.querySelector("main");
const statusLine = document.querySelector("#status");
const content = document.querySelector("#content");
const runId = root.dataset.run;
const token = root.dataset.token;
const reelTemplates = JSON.parse(root.dataset.templates);
const defaultTemplate = reelTemplates[0][0];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function openArchive() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("clipcast-saved-runs", 1);
        request.onupgradeneeded = () => {
            const archive = request.result;
            archive.createObjectStore("runs", {keyPath: "id"});
            archive.createObjectStore("media");
            archive.createObjectStore("drafts");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function read(archive, store, key) {
    return new Promise((resolve, reject) => {
        const table = archive.transaction(store).objectStore(store);
        const request = key === undefined ? table.getAll() : table.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function write(archive, store, value, key, timeout = 0) {
    return new Promise((resolve, reject) => {
        const transaction = archive.transaction(store, "readwrite");
        const table = transaction.objectStore(store);
        if (key === undefined) table.put(value);
        else table.put(value, key);
        const timer = timeout && setTimeout(() => {
            reject(new Error("Safari took too long to save the Reel."));
            try { transaction.abort(); } catch (_) {}
        }, timeout);
        transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
        transaction.onabort = transaction.onerror = () => { clearTimeout(timer); reject(transaction.error); };
    });
}

function node(tag, text = "", className = "") {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function link(text, url, className = "") {
    const element = node("a", text, className);
    element.href = url;
    return element;
}

function announce(text, error = false) {
    statusLine.textContent = text;
    statusLine.classList.toggle("error", error);
}

async function response(url, options) {
    const result = await fetch(url, options);
    if (!result.ok) {
        const message = await result.json().catch(() => ({}));
        const error = new Error(typeof message.detail === "string" ? message.detail : "The recorder could not complete the request.");
        error.status = result.status;
        throw error;
    }
    return result;
}

async function editRequest(url, connectionMessage, options = {}, {onRetry = () => {}, timeout = 35000} = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await (await response(url, {
                ...options, cache: "no-store", signal: AbortSignal.timeout(timeout)
            })).json();
        } catch (error) {
            if (error.status === 401) throw new Error("Sign in to ClipCast again, then retry this clip.");
            if (error.status && error.status < 500 && error.status !== 408) throw error;
            if (attempt === 2) throw new Error(connectionMessage);
            onRetry();
            await delay(2000);
        }
    }
}

const manifestUrl = id => "/runs/" + encodeURIComponent(id) + "/manifest";
const runUrl = id => "/saved/" + encodeURIComponent(id);
const mediaKey = (run, clip) => run + "/" + clip;
const exportKey = id => "export/" + id;
const reelTaskKey = id => "reel-task/" + id;
const uploadTaskKey = id => "upload-task/" + id;
const labelDate = value => new Date(value).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});

function saveSnapshot(archive, run) {
    return new Promise((resolve, reject) => {
        const transaction = archive.transaction("runs", "readwrite");
        const table = transaction.objectStore("runs");
        const existing = table.get(run.id);
        existing.onsuccess = () => {
            const saved = existing.result;
            if (saved?.complete && !run.complete) return;
            const current = run.clips.map(({url, edit_url, edit, reels, reels_url, bundle_url, ...clip}) => clip);
            const clips = new Map((saved?.clips || []).map(clip => [clip.id, clip]));
            for (const clip of current) clips.set(clip.id, clip);
            table.put({...run, clips: run.complete ? current : [...clips.values()]});
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
    });
}

async function capture() {
    const openSaved = link("Review available clips", runUrl(runId), "secondary");
    openSaved.hidden = true;
    const channelList = node("div");
    content.replaceChildren(openSaved, channelList);

    for (;;) {
        const run = await editRequest(manifestUrl(runId), "Could not check the recorder. Open this run again shortly.");
        if (run.complete) {
            location.replace(runUrl(run.id));
            return;
        }
        channelList.replaceChildren(...run.channels.map(channel => {
            const card = node("article");
            card.append(node("strong", channel.name), node("p", channel.status, "muted"));
            return card;
        }));
        openSaved.hidden = run.clips.length === 0;
        announce("ClipCast is working. Reopen this run when you’re ready.");
        await delay(5000);
    }
}

async function saveRunOnDevice(archive, button) {
    button.disabled = true;
    try {
        const run = await (await response(manifestUrl(runId), {cache: "no-store"})).json();
        if (!run.complete || run.clips.some(clip => !clip.edit.done)) {
            throw new Error("Wait for ClipCast to finish working, then save this run.");
        }
        for (const [index, clip] of run.clips.entries()) {
            announce("Saving clip " + (index + 1) + " of " + run.clips.length + " on this device…");
            const id = mediaKey(run.id, clip.id);
            let file = await read(archive, "media", id);
            if (file?.size !== clip.bytes) {
                file = await (await response(clip.url)).blob();
                if (file.size !== clip.bytes) throw new Error("A clip did not finish transferring. Try saving this run again.");
                await write(archive, "media", file, id);
            }
            if (clip.edit.url) {
                const reel = await fetchReel(clip.edit.url, new AbortController(), () => {});
                await write(archive, "media", reel, exportKey(id), 20000);
            }
        }
        await saveSnapshot(archive, run);
        void navigator.storage?.persist?.().catch(() => false);
        await response("/runs/" + encodeURIComponent(runId) + "/saved", {
            method: "POST", body: new URLSearchParams({token, revision: run.revision})
        });
        location.reload();
    } catch (error) {
        announce(storageError(error), true);
        button.disabled = false;
    }
}

async function archiveIndex(archive) {
    const runs = (await read(archive, "runs")).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (runs.length === 0) announce("No recordings have been saved in this browser yet.");
    for (const run of runs) {
        const card = node("article");
        card.append(node("h2", labelDate(run.created_at)));
        card.append(node("p", run.channels.map(channel => channel.name).join(", ")), link(
            run.clips.length + (run.clips.length === 1 ? " clip" : " clips"), runUrl(run.id)
        ));
        content.append(card);
    }
}

function field(label, control) {
    const element = node("label", label);
    element.append(control);
    return element;
}

function select(options) {
    const control = node("select");
    for (const [value, description] of options) {
        const option = node("option", description);
        option.value = value;
        control.append(option);
    }
    return control;
}

async function showDownload(archive, id, filename, target) {
    const file = await read(archive, "media", exportKey(id));
    if (!file) return;
    linkFromBlob(file, filename, target);
}

function linkFromBlob(file, filename, target) {
    if (target.firstChild?.href.startsWith("blob:")) URL.revokeObjectURL(target.firstChild.href);
    const download = link("Download ClipCast Reel", URL.createObjectURL(file));
    download.download = filename;
    target.replaceChildren(download);
}

async function fetchReel(url, controller, onProgress) {
    let timer;
    function resetTimer() {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), 30000);
    }
    resetTimer();
    try {
        const result = await response(url, {cache: "no-store", signal: controller.signal});
        const total = Number(result.headers.get("Content-Length"));
        const reader = result.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            resetTimer();
            chunks.push(value);
            received += value.byteLength;
            if (total) onProgress(Math.min(100, Math.floor(100 * received / total)));
        }
        if (!received || (total && received !== total)) throw new Error("The Reel download was incomplete.");
        return new Blob(chunks, {type: "video/mp4"});
    } finally {
        clearTimeout(timer);
    }
}

async function clipCard(archive, run, clip, rank, recorderUnavailable) {
    const id = mediaKey(run.id, clip.id);
    const card = node("article");
    const summary = node("p", clip.reasons.join(" · "), "muted");
    card.append(node("h3", "Clip " + rank + " · " + clip.seconds + "s"), summary);
    if (clip.skip_reason) card.append(node("p", "Skipped for the campaign. " + clip.skip_reason, "muted"));
    const previewButton = node("button", "Play clip", "secondary");
    previewButton.type = "button";
    const video = node("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "none";
    video.hidden = true;
    video.setAttribute("aria-label", "Preview clip " + rank);
    previewButton.onclick = async () => {
        try {
            if (clip.url) {
                video.src = clip.url;
            } else {
                const file = await read(archive, "media", id);
                if (!file) throw new Error("This clip's video is missing from this browser.");
                video.src = URL.createObjectURL(file);
            }
            video.hidden = false;
            previewButton.hidden = true;
            await video.play().catch(() => {});
        } catch (error) {
            progress.textContent = error.message;
        }
    };

    const hook = node("input");
    hook.type = "text";
    hook.maxLength = 64;
    hook.placeholder = "Write a hook";
    const narration = node("textarea");
    narration.rows = 2;
    narration.maxLength = 110;
    const template = select(reelTemplates);
    const crop = select([["center", "Centre"], ["left", "Left"], ["right", "Right"]]);
    const cam = select([
        ["auto", "Detect facecam"], ["off", "Gameplay only"],
        ["top-left", "Top left"], ["top-right", "Top right"],
        ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]
    ]);
    const draft = await read(archive, "drafts", id);
    template.value = draft?.template || defaultTemplate;
    if (!template.value) template.value = defaultTemplate;
    hook.value = draft?.hook || clip.edit?.hook || "";
    narration.value = draft?.narration || "";
    crop.value = draft?.crop || "center";
    cam.value = draft?.cam || "auto";
    const draftData = () => ({
        hook: hook.value, narration: narration.value, crop: crop.value, cam: cam.value, template: template.value
    });

    const progress = node("p", "", "muted");
    progress.setAttribute("role", "status");
    let draftWrites = Promise.resolve();
    function saveDraft() {
        const snapshot = draftData();
        draftWrites = draftWrites.catch(() => {}).then(() => write(archive, "drafts", snapshot, id));
        return draftWrites;
    }
    for (const control of [hook, narration, crop, cam, template]) {
        control.addEventListener("input", () => {
            void saveDraft().catch(() => { progress.textContent = "The draft could not be saved on this device."; });
        });
    }
    const settings = node("details");
    settings.append(node("summary", "Captions and framing"), field("Written narration", narration),
        field("Gameplay framing", crop), field("Streamer facecam", cam));
    const suggest = node("button", "Suggest hook first", "secondary");
    const render = node("button", "Make ClipCast version");
    suggest.type = render.type = "button";
    const hookField = field("Top hook", hook);
    function showHookControls() {
        hookField.hidden = ![defaultTemplate, "channel-vi-custom", "gta-clipcast-custom"].includes(template.value);
        suggest.hidden = template.value !== defaultTemplate;
    }
    template.addEventListener("change", showHookControls);
    const downloads = node("div");
    const filename = clip.channel + "-clipcast-" + rank + ".mp4";
    function showDirectDownload(url) {
        const direct = link("Download ClipCast Reel", url);
        direct.download = filename;
        if (downloads.firstChild?.href.startsWith("blob:")) URL.revokeObjectURL(downloads.firstChild.href);
        downloads.replaceChildren(direct);
        return direct;
    }
    await showDownload(archive, id, filename, downloads);
    if (clip.edit?.url) showDirectDownload(clip.edit.url);
    if (clip.edit) progress.textContent = clip.edit.error || (clip.edit.url ? "Reel ready." : clip.edit.message);
    const previousTask = clip.edit_url ? null : await read(archive, "drafts", reelTaskKey(id));

    let pendingUpload = clip.edit_url ? null : await read(archive, "drafts", uploadTaskKey(id));
    if (pendingUpload?.kind === "reel") {
        template.value = JSON.parse(pendingUpload.options).template || defaultTemplate;
        if (!template.value) template.value = defaultTemplate;
        template.disabled = true;
    }
    showHookControls();
    let working = false;
    async function uploadClip(file, kind, resume) {
        const options = resume ? pendingUpload.options : JSON.stringify({...draftData(), kind, size: file.size});
        if (pendingUpload?.options !== options) {
            const next = {options, kind, key: crypto.randomUUID().replaceAll("-", "")};
            await write(archive, "drafts", next, uploadTaskKey(id), 20000);
            pendingUpload = next;
        }
        progress.textContent = "Connecting to the ClipCast recorder…";
        const paused = "Upload paused. Return to this clip or tap Resume to continue.";
        const session = await editRequest("/saved-edits/session", paused, {}, {timeout: 65000});
        const url = "/saved-edits/uploads/" + pendingUpload.key;
        const tokenHeader = {"X-ClipCast-Token": session.token};
        const upload = await editRequest(url, paused, {
            method: "PUT", body: options, headers: {...tokenHeader, "Content-Type": "application/json"}
        });
        for (let offset = upload.received; offset < file.size;) {
            const percent = Math.floor(100 * offset / file.size) + "%";
            progress.textContent = "Uploading from this phone · " + percent;
            const body = await file.slice(offset, offset + upload.chunk_bytes).arrayBuffer();
            const part = await editRequest(url + "/parts/" + offset, paused, {
                method: "PUT", body, headers: {...tokenHeader, "Content-Type": "video/mp4"}
            }, {onRetry: () => { progress.textContent = "Reconnecting · " + percent + " uploaded"; }});
            offset = part.received;
        }
        progress.textContent = "Upload complete. Checking the clip…";
        return editRequest(url + "/finish", paused, {method: "POST", headers: tokenHeader});
    }

    async function clearPendingUpload() {
        await write(archive, "drafts", null, uploadTaskKey(id), 20000);
        pendingUpload = null;
    }

    async function processClip(kind, resumeTask, resumeUpload = false) {
        if (working) return;
        working = true;
        suggest.disabled = render.disabled = template.disabled = true;
        try {
            let statusUrl = clip.edit_url;
            if (!resumeTask) {
                if (clip.edit_url) {
                    void saveDraft().catch(() => {});
                    const request_id = crypto.randomUUID().replaceAll("-", "");
                    await editRequest(statusUrl, "Could not queue this edit. Reopen the run to check its status.", {
                        method: "POST",
                        headers: {"X-ClipCast-Token": token, "Content-Type": "application/json"},
                        body: JSON.stringify({...draftData(), kind, request_id})
                    });
                    progress.textContent = "Queued in ClipCast. You can leave this page.";
                } else {
                    await saveDraft();
                    const file = await read(archive, "media", id);
                    if (!file) throw new Error("This clip's video is missing from this browser.");
                    const task = await uploadClip(file, kind, resumeUpload);
                    statusUrl = "/saved-edits/" + task.id;
                    if (kind === "reel") {
                        await write(archive, "drafts", task, reelTaskKey(id), 20000);
                    }
                    await clearPendingUpload();
                }
            } else {
                if (!statusUrl) {
                    statusUrl = "/saved-edits/" + resumeTask.id;
                    if (pendingUpload?.key === resumeTask.id) await clearPendingUpload();
                }
                progress.textContent = kind === "hook" ? "Checking the hook…" : "Checking your ClipCast Reel…";
            }
            let state;
            for (;;) {
                state = await editRequest(statusUrl, "Could not check this edit. Reopen the run to check its status.");
                if (state.done) break;
                progress.textContent = {
                    queued: "Reel queued. You can leave this page.",
                    hook_queued: "Hook queued. You can leave this page.",
                    verifying: "Checking the uploaded clip…",
                    suggesting: "Looking for a hook…",
                    rendering: "Making your ClipCast Reel. You can leave this page."
                }[state.phase] || "ClipCast is working…";
                await delay(2500);
            }
            if (state.error) {
                if (kind === "reel" && !clip.edit_url) void write(archive, "drafts", null, reelTaskKey(id), 20000).catch(() => {});
                throw new Error(state.error);
            }
            if (kind === "hook") {
                if (state.hook) {
                    hook.value = state.hook;
                    await saveDraft();
                }
                progress.textContent = state.message;
            } else if (clip.edit_url) {
                showDirectDownload(state.url);
                progress.textContent = "Reel ready.";
            } else {
                const url = statusUrl + "/video";
                const direct = showDirectDownload(url);
                const controller = new AbortController();
                direct.addEventListener("click", () => controller.abort(), {once: true});
                progress.textContent = "Reel ready. Saving a copy in ClipCast…";
                try {
                    const finished = await fetchReel(url, controller, percent => {
                        progress.textContent = "Reel ready. Saving a copy in ClipCast · " + percent + "%";
                    });
                    await write(archive, "media", finished, exportKey(id), 20000);
                    linkFromBlob(finished, filename, downloads);
                    progress.textContent = "Reel saved in ClipCast.";
                    void write(archive, "drafts", null, reelTaskKey(id), 20000).catch(() => {});
                } catch (_) {
                    progress.textContent = "Reel ready. Use Download ClipCast Reel to save it to Files.";
                }
            }
        } catch (error) {
            if (kind === "reel" && !clip.edit_url && error.status === 404) {
                void write(archive, "drafts", null, reelTaskKey(id), 20000).catch(() => {});
            }
            progress.textContent = storageError(error);
        } finally {
            working = false;
            suggest.disabled = render.disabled = false;
            template.disabled = pendingUpload?.kind === "reel";
            suggest.textContent = pendingUpload?.kind === "hook" ? "Resume hook upload" : "Suggest hook first";
            render.textContent = pendingUpload?.kind === "reel" ? "Resume Reel upload" : "Make ClipCast version";
        }
    }
    suggest.onclick = () => processClip("hook", null, pendingUpload?.kind === "hook");
    render.onclick = () => processClip("reel", null, pendingUpload?.kind === "reel");
    card.append(previewButton, video);
    if (clip.reels_url) card.append(pairDownload(clip, hook, progress));
    card.append(field("Reel template", template), hookField, suggest, settings, render, progress, downloads);
    for (const reel of Object.values(clip.reels || {})) {
        if (reel.download_url) card.append(link("Download " + reel.label + " Reel", reel.download_url));
    }
    if (clip.transcript?.length) {
        const transcript = node("details");
        transcript.append(node("summary", "Timestamped transcript"));
        for (const [start, end, text] of clip.transcript) {
            transcript.append(node("p", start.toFixed(1) + "–" + end.toFixed(1) + "s · " + text));
        }
        card.append(transcript);
    }
    function resumePhoneUpload() {
        if (!document.hidden && pendingUpload && !working) {
            void processClip(pendingUpload.kind, null, true);
        }
    }
    if (recorderUnavailable) {
        suggest.disabled = render.disabled = true;
    } else if (clip.edit && !clip.edit.done) {
        void processClip(clip.edit.kind, clip.edit);
    } else if (!clip.edit_url) {
        document.addEventListener("visibilitychange", resumePhoneUpload);
        window.addEventListener("online", resumePhoneUpload);
        if (previousTask?.id) void processClip("reel", previousTask);
        else resumePhoneUpload();
    }
    return card;
}

function pairDownload(clip, hook, progress) {
    const label = "Download both Reels";
    const area = node("div");
    const download = link(label, clip.bundle_url);
    download.download = "";
    const ready = reels => reels["channel-vi"]?.download_url && reels["gta-clipcast"]?.download_url;
    if (ready(clip.reels || {})) {
        area.append(download);
        return area;
    }

    const button = node("button", label);
    button.type = "button";
    button.onclick = async () => {
        button.disabled = true;
        const readStatus = () => editRequest(clip.reels_url, "Could not check the two Reels. Reopen this run to try again.");
        const working = reels => Object.values(reels).some(reel => ["queued", "rendering"].includes(reel.phase));
        try {
            let reels = await readStatus();
            if (!ready(reels) && !working(reels)) {
                const headline = hook.value.trim();
                try {
                    reels = await editRequest(clip.reels_url, "Could not queue both Reels.", {
                        method: "POST",
                        headers: {"Content-Type": "application/json", "X-ClipCast-Token": token},
                        body: JSON.stringify({
                            request_id: crypto.randomUUID().replaceAll("-", ""),
                            channel_vi_hook: reels["channel-vi"]?.hook || headline,
                            gta_clipcast_hook: reels["gta-clipcast"]?.hook || headline
                        })
                    });
                } catch (error) {
                    if (error.status !== 409) throw error;
                    reels = await readStatus();
                    if (!working(reels) && !ready(reels)) throw error;
                }
            }
            while (working(reels)) {
                progress.textContent = "Making Channel VI and GTA ClipCast Reels. You can reopen this run later.";
                await delay(2500);
                reels = await readStatus();
            }
            if (!ready(reels)) throw new Error("One Reel failed. Tap Download both Reels to retry.");
            area.replaceChildren(download);
            progress.textContent = "Both Reels are ready in one ZIP.";
            if (!document.hidden) download.click();
        } catch (error) {
            progress.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    };
    area.append(button);
    return area;
}

async function review(archive) {
    const local = await read(archive, "runs", runId);
    let remote;
    let recorderUnavailable = false;
    try {
        remote = await editRequest(manifestUrl(runId), "The recorder did not respond. Try reopening this run.", {}, {timeout: 65000});
    } catch (error) {
        if (error.status !== 404 && !local) throw error;
        recorderUnavailable = error.status !== 404;
    }
    const run = remote || local;
    if (!run) {
        announce("This run has expired on the recorder. Check Saved clips for any copies on this device.", true);
        return;
    }
    if (remote) {
        announce("On the recorder · " + labelDate(run.created_at));
        if (remote.complete) {
            const copyIsCurrent = local?.complete && local.revision === remote.revision;
            const save = node("button", copyIsCurrent ? "Run saved to this device" : "Save run to this device", "secondary");
            save.disabled = Boolean(copyIsCurrent);
            save.type = "button";
            save.onclick = () => saveRunOnDevice(archive, save);
            content.append(save);
        } else {
            content.append(link("Check recording progress", "/runs/" + encodeURIComponent(runId), "secondary"));
        }
    } else {
        announce("Saved on this device · " + labelDate(run.created_at));
        if (recorderUnavailable) {
            content.append(node("p", "The recorder is unreachable. You can play saved clips. Reopen the run when you’re connected to make a Reel."));
        } else {
            content.append(node("p", "These clips are on your phone. Making a new Reel requires an upload. If it pauses, reopen this run to resume."));
        }
        if (!run.complete) {
            content.append(node("p", "This device only saved part of this run."));
        }
    }
    if (run.clips.length === 0) {
        content.append(node("p", run.complete ? "No strong highlights were found in this run." : "No clips are ready yet."));
    }
    let rank = 0;
    const sections = new Map();
    for (const channel of run.channels) {
        const section = node("section");
        section.append(node("h2", channel.name));
        if (!run.clips.some(clip => clip.channel === channel.name)) {
            section.append(node("p", "No highlight selected.", "muted"));
        }
        sections.set(channel.name, section);
        content.append(section);
    }
    for (const clip of run.clips) {
        sections.get(clip.channel).append(await clipCard(archive, run, clip, ++rank, recorderUnavailable));
    }
    if (!local) return;
    const remove = node("button", "Delete copy on this device", "secondary");
    remove.type = "button";
    remove.onclick = async () => {
        if (!window.confirm("Delete this run and its clips from this browser?")) return;
        try {
            if (remote) {
                await response("/runs/" + encodeURIComponent(runId) + "/saved/forget", {
                    method: "POST", body: new URLSearchParams({token})
                });
            } else if (recorderUnavailable) {
                throw new Error("Reconnect to the recorder before deleting this copy.");
            }
            await deleteRun(archive, local);
            location.assign("/saved");
        } catch (error) {
            announce(storageError(error), true);
        }
    };
    content.append(remove);
}

function deleteRun(archive, run) {
    return new Promise((resolve, reject) => {
        const transaction = archive.transaction(["runs", "media", "drafts"], "readwrite");
        const media = transaction.objectStore("media");
        const drafts = transaction.objectStore("drafts");
        for (const clip of run.clips) {
            const id = mediaKey(run.id, clip.id);
            media.delete(id);
            media.delete(exportKey(id));
            drafts.delete(id);
            drafts.delete(reelTaskKey(id));
            drafts.delete(uploadTaskKey(id));
        }
        transaction.objectStore("runs").delete(run.id);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
    });
}

function storageError(error) {
    return error?.name === "QuotaExceededError"
        ? "This browser is out of storage. Free up space and try again."
        : error?.message || "ClipCast could not save this run in your browser.";
}

async function start() {
    if (root.dataset.view === "capture") {
        await capture();
        return;
    }
    const archive = await openArchive();
    switch (root.dataset.view) {
    case "index": await archiveIndex(archive); break;
    case "review": await review(archive); break;
    }
}

start().catch(error => {
    announce(storageError(error), true);
    if (root.dataset.view === "capture") content.append(link("Check the run again", location.pathname));
});
