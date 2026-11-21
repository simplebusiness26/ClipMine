"use strict";

const root = document.querySelector("main");
const statusLine = document.querySelector("#status");
const content = document.querySelector("#content");
const runId = root.dataset.run;
const token = root.dataset.token;
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

function write(archive, store, value, key) {
    return new Promise((resolve, reject) => {
        const transaction = archive.transaction(store, "readwrite");
        const table = transaction.objectStore(store);
        if (key === undefined) table.put(value);
        else table.put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
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

async function editStatus(url, connectionMessage) {
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return await (await response(url, {
                cache: "no-store", signal: AbortSignal.timeout(25000)
            })).json();
        } catch (error) {
            if (error.status === 401) throw new Error("Sign in to ClipCast again, then retry this clip.");
            if (error.status && error.status < 500) throw error;
            if (attempt === 3) throw new Error(connectionMessage);
            await delay(2000);
        }
    }
}

const runUrl = id => "/saved/" + encodeURIComponent(id);
const mediaKey = (run, clip) => run + "/" + clip;
const exportKey = id => "export/" + id;
const labelDate = value => new Date(value).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});

function saveSnapshot(archive, run) {
    return new Promise((resolve, reject) => {
        const transaction = archive.transaction("runs", "readwrite");
        const table = transaction.objectStore("runs");
        const existing = table.get(run.id);
        existing.onsuccess = () => {
            const saved = existing.result;
            if (saved?.complete) return;
            const current = run.clips.map(({url, ...clip}) => clip);
            const clips = new Map((saved?.clips || []).map(clip => [clip.id, clip]));
            for (const clip of current) clips.set(clip.id, clip);
            table.put({...run, clips: run.complete ? current : [...clips.values()]});
        };
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
    });
}

async function capture(archive) {
    const old = await read(archive, "runs", runId);
    if (old?.complete) {
        location.replace(runUrl(runId));
        return;
    }
    const savedIds = new Set((old?.clips || []).map(clip => clip.id));
    const openSaved = link("Watch clips saved so far", runUrl(runId), "secondary");
    openSaved.target = "_blank";
    openSaved.rel = "noopener";
    openSaved.hidden = savedIds.size === 0;
    const progress = node("progress");
    progress.hidden = true;
    const channelList = node("div");
    content.replaceChildren(openSaved, progress, channelList);

    let failures = 0;
    for (;;) {
        let run;
        try {
            run = await (await response("/runs/" + encodeURIComponent(runId) + "/manifest")).json();
            failures = 0;
        } catch (error) {
            if ([401, 403, 404].includes(error.status) || ++failures >= 4) throw error;
            announce("Connection interrupted. Checking the run again…");
            await delay(5000);
            continue;
        }
        channelList.replaceChildren(...run.channels.map(channel => {
            const card = node("article");
            card.append(node("strong", channel.name), node("p", channel.status, "muted"));
            return card;
        }));
        progress.max = Math.max(run.clips.length, 1);
        progress.value = savedIds.size;
        progress.hidden = run.clips.length === 0;
        const transferred = [];
        for (const clip of run.clips) {
            if (!savedIds.has(clip.id)) {
                announce("Saving a finished clip on this device…");
                const key = mediaKey(run.id, clip.id);
                let file = await read(archive, "media", key);
                if (file?.size !== clip.bytes) {
                    file = await (await response(clip.url)).blob();
                    if (file.size !== clip.bytes) throw new Error("A clip did not finish transferring. Try saving this run again.");
                    await write(archive, "media", file, key);
                }
                savedIds.add(clip.id);
                progress.value = savedIds.size;
                await saveSnapshot(archive, {...run, complete: false, clips: [...transferred, clip]});
                openSaved.hidden = false;
            }
            transferred.push(clip);
        }
        if (run.complete) {
            await saveSnapshot(archive, run);
            // The archive is committed even if the recorder restarts during cleanup.
            void navigator.storage?.persist?.().catch(() => false);
            try {
                await response("/runs/" + encodeURIComponent(runId) + "/saved", {
                    method: "POST", body: new URLSearchParams({token}),
                    signal: AbortSignal.timeout(3000)
                });
            } catch (_) {}
            location.replace(runUrl(run.id));
            return;
        }
        announce(savedIds.size ? savedIds.size + " clips saved. Checking the remaining streams…" : "Recording or processing your streams…");
        await delay(5000);
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
    if (target.firstChild) URL.revokeObjectURL(target.firstChild.href);
    const download = link("Download ClipCast Reel", URL.createObjectURL(file));
    download.download = filename;
    target.replaceChildren(download);
}

async function clipCard(archive, run, clip, rank) {
    const id = mediaKey(run.id, clip.id);
    const card = node("article");
    const summary = node("p", clip.reasons.join(" · "), "muted");
    card.append(node("h3", "Clip " + rank + " · " + clip.seconds + "s"), summary);
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
            const file = await read(archive, "media", id);
            if (!file) throw new Error("This clip's video is missing from this browser.");
            video.src = URL.createObjectURL(file);
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
    const crop = select([["center", "Centre"], ["left", "Left"], ["right", "Right"]]);
    const cam = select([
        ["auto", "Detect facecam"], ["off", "Gameplay only"],
        ["top-left", "Top left"], ["top-right", "Top right"],
        ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]
    ]);
    const draft = await read(archive, "drafts", id);
    hook.value = draft?.hook || "";
    narration.value = draft?.narration || "";
    crop.value = draft?.crop || "center";
    cam.value = draft?.cam || "auto";
    const draftData = () => ({hook: hook.value, narration: narration.value, crop: crop.value, cam: cam.value});

    const progress = node("p", "", "muted");
    progress.setAttribute("role", "status");
    let draftWrites = Promise.resolve();
    function saveDraft() {
        const snapshot = draftData();
        draftWrites = draftWrites.catch(() => {}).then(() => write(archive, "drafts", snapshot, id));
        return draftWrites;
    }
    for (const control of [hook, narration, crop, cam]) {
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
    const downloads = node("div");
    const filename = clip.channel + "-clipcast-" + rank + ".mp4";
    await showDownload(archive, id, filename, downloads);

    async function processClip(kind) {
        suggest.disabled = render.disabled = true;
        try {
            await saveDraft();
            const file = await read(archive, "media", id);
            if (!file) throw new Error("This clip's video is missing from this browser.");
            progress.textContent = "Connecting to the ClipCast recorder…";
            const session = await editStatus("/saved-edits/session", "Could not reach ClipCast. Try again shortly. Your original is still saved here.");
            // Small clips use fresh bytes so Safari can upload without a disk-backed form part.
            const body = file.size <= 24 * 1024 * 1024 ? await file.arrayBuffer() : file;
            progress.textContent = "Sending this clip to ClipCast…";
            let task;
            try {
                task = await (await response("/saved-edits/video", {
                    method: "POST", body,
                    headers: {
                        "Content-Type": "video/mp4",
                        "X-ClipCast-Token": session.token,
                        "X-ClipCast-Size": String(file.size),
                        "X-ClipCast-Options": encodeURIComponent(JSON.stringify({...draftData(), kind}))
                    }
                })).json();
            } catch (error) {
                if (error.status) throw error;
                throw new Error("The clip upload was interrupted. Your original is still saved here. Tap again to retry.");
            }
            let state;
            for (;;) {
                progress.textContent = kind === "hook" ? "Looking for a hook…" : "Making your ClipCast Reel…";
                state = await editStatus("/saved-edits/" + task.id, "Lost the connection while ClipCast was working. Your original is still saved here.");
                if (state.done) break;
                await delay(2500);
            }
            if (state.error) throw new Error(state.error);
            if (kind === "hook") {
                if (state.hook) {
                    hook.value = state.hook;
                    await saveDraft();
                }
                progress.textContent = state.message;
            } else {
                progress.textContent = "Saving the finished Reel on this device…";
                const finished = await (await response("/saved-edits/" + task.id + "/video")).blob();
                await write(archive, "media", finished, exportKey(id));
                linkFromBlob(finished, filename, downloads);
                progress.textContent = "Reel saved.";
            }
        } catch (error) {
            progress.textContent = storageError(error);
        } finally {
            suggest.disabled = render.disabled = false;
        }
    }
    suggest.onclick = () => processClip("hook");
    render.onclick = () => processClip("reel");
    card.append(previewButton, video, field("Top hook", hook), suggest, settings, render, progress, downloads);
    return card;
}

async function review(archive) {
    const run = await read(archive, "runs", runId);
    if (!run) {
        announce("This run is not saved in this browser.", true);
        return;
    }
    announce("Saved on this device · " + labelDate(run.created_at));
    if (!run.complete) {
        content.append(node("p", "This run was still processing when these clips were saved."),
            link("Check run for more clips", "/runs/" + encodeURIComponent(runId), "secondary"));
    }
    if (run.clips.length === 0) content.append(node("p", "No strong highlights were found in this run."));
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
        sections.get(clip.channel).append(await clipCard(archive, run, clip, ++rank));
    }
    const remove = node("button", "Delete this saved run", "secondary");
    remove.type = "button";
    remove.onclick = async () => {
        if (!window.confirm("Delete this run and its clips from this browser?")) return;
        try {
            await deleteRun(archive, run);
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
    const archive = await openArchive();
    switch (root.dataset.view) {
    case "capture": await capture(archive); break;
    case "index": await archiveIndex(archive); break;
    case "review": await review(archive); break;
    }
}

start().catch(error => {
    announce(storageError(error), true);
    if (root.dataset.view === "capture") content.append(link("Try saving this run again", location.pathname));
});
