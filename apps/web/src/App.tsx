import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, mediaUrl, uploadProject } from "./api";
import { formatDate, formatDuration, statusLabel } from "./format";
import type {
  CandidateUpdate,
  ClipCandidate,
  Project,
  PublicConfig,
  UploadOptions,
} from "./types";

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <path d="M9 13.5 15 7h10l6 6.5L20 34 9 13.5Z" />
        <path d="m9 13.5 11 5 11-5M15 7l5 11 5-11M20 18v16" />
      </svg>
    </span>
  );
}

function Brand() {
  return (
    <div className="brand" aria-label="ClipMine home">
      <LogoMark />
      <span>ClipMine</span>
    </div>
  );
}

function StatusDot({ status }: { status: Project["status"] }) {
  return <span aria-hidden="true" className={`status-dot status-dot--${status}`} />;
}

function AppHeader({ onHome, project }: { onHome: () => void; project?: Project }) {
  return (
    <header className="app-header">
      <button className="brand-button" onClick={onHome} type="button">
        <Brand />
      </button>
      {project ? (
        <div className="header-project">
          <span className="header-project__eyebrow">Project</span>
          <strong>{project.title}</strong>
        </div>
      ) : (
        <div className="header-pill">
          <span className="header-pill__light" />
          Private MVP
        </div>
      )}
    </header>
  );
}

function UploadPanel({
  config,
  onUploaded,
}: {
  config: PublicConfig | null;
  onUploaded: (project: Project) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [desiredClips, setDesiredClips] = useState(5);
  const [lengthPreset, setLengthPreset] = useState<"quick" | "standard" | "deep">(
    "standard",
  );
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const selectFile = (nextFile?: File) => {
    if (!nextFile) return;
    setFile(nextFile);
    if (!title) setTitle(nextFile.name.replace(/\.[^.]+$/, ""));
    setError(null);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("Choose an original video first.");
      return;
    }
    if (!rightsConfirmed) {
      setError("Confirm that you are authorised to process and republish this video.");
      return;
    }
    const ranges = {
      quick: [15, 35],
      standard: [25, 60],
      deep: [45, 90],
    } as const;
    const [minSeconds, maxSeconds] = ranges[lengthPreset];
    const options: UploadOptions = {
      file,
      title,
      desiredClips,
      minSeconds,
      maxSeconds,
      language: "auto",
      rightsConfirmed,
    };
    try {
      setUploading(true);
      setProgress(1);
      setError(null);
      const project = await uploadProject(options, setProgress);
      onUploaded(project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="upload-card" aria-labelledby="new-project-title">
      <div className="upload-card__intro">
        <span className="eyebrow">New project</span>
        <h2 id="new-project-title">Drop in the long video.</h2>
        <p>ClipMine will transcribe it, find complete moments and prepare vertical drafts.</p>
      </div>
      <form onSubmit={submit}>
        <div
          className={`drop-zone ${dragging ? "drop-zone--dragging" : ""} ${file ? "drop-zone--selected" : ""}`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <input
            accept="video/mp4,video/quicktime,video/webm,.m4v"
            className="sr-only"
            onChange={onFileChange}
            ref={inputRef}
            type="file"
          />
          <button
            className="drop-zone__button"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <span className="drop-zone__icon">
              <Icon size={24}>
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
              </Icon>
            </span>
            {file ? (
              <span className="drop-zone__copy">
                <strong>{file.name}</strong>
                <small>{(file.size / 1024 / 1024).toFixed(1)} MB · Tap to replace</small>
              </span>
            ) : (
              <span className="drop-zone__copy">
                <strong>Choose a video</strong>
                <small>MP4, MOV or WebM · up to {config?.max_upload_mb ?? 1024} MB</small>
              </span>
            )}
          </button>
        </div>

        <label className="field">
          <span>Project name</span>
          <input
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Weekly podcast — episode 12"
            type="text"
            value={title}
          />
        </label>

        <div className="upload-grid">
          <label className="field">
            <span>Number of drafts</span>
            <select
              onChange={(event) => setDesiredClips(Number(event.target.value))}
              value={desiredClips}
            >
              {[3, 4, 5, 6, 8].map((number) => (
                <option key={number} value={number}>
                  {number} clips
                </option>
              ))}
            </select>
          </label>
          <fieldset className="field fieldset">
            <legend>Clip length</legend>
            <div className="segmented-control">
              {(["quick", "standard", "deep"] as const).map((preset) => (
                <button
                  className={lengthPreset === preset ? "is-active" : ""}
                  key={preset}
                  onClick={() => setLengthPreset(preset)}
                  type="button"
                >
                  {preset === "quick" ? "15–35s" : preset === "standard" ? "25–60s" : "45–90s"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <label className="rights-check">
          <input
            checked={rightsConfirmed}
            onChange={(event) => setRightsConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span>
            I own this video or have permission to edit and republish it.
            <small>ClipMine does not download arbitrary public video links.</small>
          </span>
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        {uploading && (
          <div className="upload-progress" aria-live="polite">
            <span style={{ width: `${progress}%` }} />
            <small>Uploading · {progress}%</small>
          </div>
        )}

        <button className="primary-button primary-button--wide" disabled={uploading} type="submit">
          {uploading ? "Uploading…" : "Mine this video"}
          {!uploading && (
            <Icon size={18}>
              <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </Icon>
          )}
        </button>
        <p className="first-run-note">
          The first local analysis may take longer while the speech model prepares itself.
        </p>
      </form>
    </section>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <button className="project-card" onClick={onOpen} type="button">
      <div className="project-card__thumb">
        <LogoMark />
        <span>{formatDuration(project.duration_seconds)}</span>
      </div>
      <div className="project-card__body">
        <div className="project-card__status">
          <StatusDot status={project.status} />
          {project.stage}
        </div>
        <h3>{project.title}</h3>
        <p>
          {project.status === "ready"
            ? `${project.candidates.length} suggested clips`
            : project.status === "failed"
              ? project.error_message
              : `${project.progress}% complete`}
        </p>
        <span className="project-card__date">{formatDate(project.created_at)}</span>
      </div>
      <span className="project-card__arrow">
        <Icon>
          <path d="m9 18 6-6-6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </Icon>
      </span>
    </button>
  );
}

function Dashboard({
  projects,
  config,
  onOpen,
  onUploaded,
}: {
  projects: Project[];
  config: PublicConfig | null;
  onOpen: (id: string) => void;
  onUploaded: (project: Project) => void;
}) {
  return (
    <main>
      <section className="hero">
        <div className="hero__copy">
          <span className="eyebrow"><span /> AI first-pass editor</span>
          <h1>Find the gold<br />in every video.</h1>
          <p>
            Turn one long recording into multiple short-form drafts—complete ideas, clean captions,
            ready for your final touch.
          </p>
          <div className="hero__proof">
            <span><strong>01</strong> Upload once</span>
            <span><strong>02</strong> Review the moments</span>
            <span><strong>03</strong> Export vertically</span>
          </div>
        </div>
        <UploadPanel config={config} onUploaded={onUploaded} />
      </section>

      <section className="projects-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Your workspace</span>
            <h2>Recent projects</h2>
          </div>
          <div className={`database-state ${config?.database_connected ? "is-connected" : ""}`}>
            <span />
            {config?.database_connected ? "PostgreSQL connected" : "Local storage · database ready"}
          </div>
        </div>
        {projects.length ? (
          <div className="project-grid">
            {projects.map((project) => (
              <ProjectCard key={project.id} onOpen={() => onOpen(project.id)} project={project} />
            ))}
          </div>
        ) : (
          <div className="empty-projects">
            <LogoMark />
            <h3>Your first finds will appear here.</h3>
            <p>Choose a video above to start the first ClipMine project.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function ProcessingView({ project, onRetry }: { project: Project; onRetry: () => void }) {
  if (project.status === "failed") {
    return (
      <div className="processing-state processing-state--error">
        <span className="processing-state__icon">!</span>
        <span className="eyebrow">Analysis stopped</span>
        <h1>This video needs attention.</h1>
        <p>{project.error_message || "ClipMine could not process this video."}</p>
        <button className="primary-button" onClick={onRetry} type="button">Try analysis again</button>
      </div>
    );
  }
  return (
    <div className="processing-state">
      <div className="mining-orbit" aria-hidden="true">
        <LogoMark />
        <span />
      </div>
      <span className="eyebrow">ClipMine is working</span>
      <h1>{project.stage}</h1>
      <p>You can close this page. The project state is saved and will be here when you return.</p>
      <div
        aria-label="Video processing progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={project.progress}
        className="processing-bar"
        role="progressbar"
      >
        <span style={{ width: `${project.progress}%` }} />
      </div>
      <div className="processing-meta">
        <strong>{project.progress}%</strong>
        <span>{project.source_filename}</span>
      </div>
      <ol className="stage-list">
        <li className={project.progress >= 10 ? "is-done" : "is-active"}>Inspect video</li>
        <li className={project.progress >= 35 ? "is-done" : project.progress >= 10 ? "is-active" : ""}>Transcribe speech</li>
        <li className={project.progress >= 72 ? "is-done" : project.progress >= 35 ? "is-active" : ""}>Find complete moments</li>
        <li className={project.progress >= 100 ? "is-done" : project.progress >= 72 ? "is-active" : ""}>Prepare drafts</li>
      </ol>
    </div>
  );
}

function CandidateList({
  project,
  selectedId,
  onSelect,
}: {
  project: Project;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="candidate-list">
      <div className="candidate-list__heading">
        <span className="eyebrow">Found moments</span>
        <strong>{project.candidates.length} drafts</strong>
      </div>
      <div className="candidate-list__items">
        {project.candidates.map((candidate, index) => (
          <button
            className={`candidate-item ${selectedId === candidate.id ? "is-selected" : ""}`}
            key={candidate.id}
            onClick={() => onSelect(candidate.id)}
            type="button"
          >
            <span className="candidate-item__number">{String(index + 1).padStart(2, "0")}</span>
            <span className="candidate-item__copy">
              <strong>{candidate.title}</strong>
              <small>
                {formatDuration(candidate.end_seconds - candidate.start_seconds)} · {statusLabel(candidate.confidence)}
              </small>
            </span>
            {candidate.render_status === "ready" && <span className="candidate-item__ready">✓</span>}
          </button>
        ))}
      </div>
    </aside>
  );
}

function ClipEditor({
  project,
  candidate,
  onSave,
  onRender,
}: {
  project: Project;
  candidate: ClipCandidate;
  onSave: (candidateId: string, update: CandidateUpdate) => Promise<Project>;
  onRender: (candidateId: string, update: CandidateUpdate) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [title, setTitle] = useState(candidate.title);
  const [start, setStart] = useState(candidate.start_seconds);
  const [end, setEnd] = useState(candidate.end_seconds);
  const [caption, setCaption] = useState(candidate.caption_text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(candidate.title);
    setStart(candidate.start_seconds);
    setEnd(candidate.end_seconds);
    setCaption(candidate.caption_text);
    setError(null);
    if (videoRef.current) videoRef.current.currentTime = candidate.start_seconds;
  }, [candidate.id]);

  const update: CandidateUpdate = {
    title: title.trim() || candidate.title,
    start_seconds: Number(start),
    end_seconds: Number(end),
    caption_text: caption,
  };

  const playClip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      setError(null);
      video.currentTime = start;
      await video.play();
    } catch {
      setError("The source preview could not start. Try reloading this project.");
    }
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (video && video.currentTime >= end) video.pause();
  };

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      await onSave(candidate.id, update);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this draft.");
    } finally {
      setSaving(false);
    }
  };

  const render = async () => {
    try {
      setSaving(true);
      setError(null);
      await onRender(candidate.id, update);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the render.");
    } finally {
      setSaving(false);
    }
  };

  const rendering = candidate.render_status === "queued" || candidate.render_status === "rendering";
  const dirty =
    title.trim() !== candidate.title ||
    Number(start) !== candidate.start_seconds ||
    Number(end) !== candidate.end_seconds ||
    caption !== candidate.caption_text;
  const captionPreview =
    caption.trim().split(/\s+/).slice(0, 7).join(" ") || "Your captions will appear here";

  return (
    <section className="editor-shell">
      <div className="preview-column">
        <div className="vertical-preview">
          <video
            controls
            onTimeUpdate={onTimeUpdate}
            playsInline
            preload="metadata"
            ref={videoRef}
            src={mediaUrl(project.source_url)}
          />
          <div className="caption-preview">{captionPreview}</div>
          <button aria-label="Play selected clip" className="preview-play" onClick={playClip} type="button">
            <Icon size={24}>
              <path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
            </Icon>
          </button>
          <div className="safe-area" aria-hidden="true" />
        </div>
        <div className="preview-meta">
          <span>9:16 preview</span>
          <strong>{formatDuration(end - start)}</strong>
        </div>
      </div>

      <div className="editor-panel">
        <div className="editor-panel__top">
          <div>
            <span className={`confidence confidence--${candidate.confidence}`}>{candidate.confidence}</span>
            <span className="muted-label">AI selection</span>
          </div>
          <button className="text-button" onClick={playClip} type="button">Preview range</button>
        </div>

        <label className="field">
          <span>Clip title</span>
          <input maxLength={100} onChange={(event) => setTitle(event.target.value)} value={title} />
        </label>

        <div className="time-fields">
          <label className="field">
            <span>Start (seconds)</span>
            <input
              max={project.duration_seconds ?? undefined}
              min={0}
              onChange={(event) => setStart(Number(event.target.value))}
              step="0.1"
              type="number"
              value={start}
            />
          </label>
          <label className="field">
            <span>End (seconds)</span>
            <input
              max={project.duration_seconds ?? undefined}
              min={0.1}
              onChange={(event) => setEnd(Number(event.target.value))}
              step="0.1"
              type="number"
              value={end}
            />
          </label>
        </div>

        <label className="field caption-field">
          <span>Caption copy</span>
          <textarea
            onChange={(event) => setCaption(event.target.value)}
            placeholder="Correct or add the words to burn into the exported clip."
            rows={7}
            value={caption}
          />
          <small>{caption.split(/\s+/).filter(Boolean).length} words · split automatically for export</small>
        </label>

        <div className="selection-reasons">
          <span>Why ClipMine chose this</span>
          <ul>
            {candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>

        {(error || candidate.render_error) && (
          <div className="form-error" role="alert">{error || candidate.render_error}</div>
        )}

        <div className="editor-actions">
          <button className="secondary-button" disabled={saving} onClick={save} type="button">
            {saving ? "Saving…" : "Save draft"}
          </button>
          {candidate.render_status === "ready" && candidate.export_url && !dirty ? (
            <a className="primary-button" download href={mediaUrl(candidate.export_url)}>
              Download MP4
              <Icon size={18}>
                <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </Icon>
            </a>
          ) : (
            <button className="primary-button" disabled={saving || rendering} onClick={render} type="button">
              {rendering ? "Rendering…" : dirty && candidate.render_status === "ready" ? "Render updated clip" : "Render vertical clip"}
              {!rendering && (
                <Icon size={18}>
                  <path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
                </Icon>
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ProjectWorkspace({
  project,
  onHome,
  onUpdate,
  onRetry,
  onDelete,
}: {
  project: Project;
  onHome: () => void;
  onUpdate: (project: Project) => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const [selectedId, setSelectedId] = useState(project.candidates[0]?.id ?? "");

  useEffect(() => {
    if (!project.candidates.some((item) => item.id === selectedId)) {
      setSelectedId(project.candidates[0]?.id ?? "");
    }
  }, [project.candidates, selectedId]);

  if (project.status !== "ready") {
    return (
      <>
        <AppHeader onHome={onHome} project={project} />
        <main className="workspace workspace--processing">
          <ProcessingView onRetry={onRetry} project={project} />
        </main>
      </>
    );
  }

  const candidate = project.candidates.find((item) => item.id === selectedId);
  const save = async (candidateId: string, update: CandidateUpdate) => {
    const next = await api.updateCandidate(project.id, candidateId, update);
    onUpdate(next);
    return next;
  };
  const render = async (candidateId: string, update: CandidateUpdate) => {
    await save(candidateId, update);
    const next = await api.renderCandidate(project.id, candidateId);
    onUpdate(next);
  };

  return (
    <>
      <AppHeader onHome={onHome} project={project} />
      <main className="workspace">
        <div className="workspace-heading">
          <div>
            <button className="back-button" onClick={onHome} type="button">
              <Icon size={18}>
                <path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </Icon>
              All projects
            </button>
            <span className="eyebrow">Ready to shape</span>
            <h1>{project.title}</h1>
            <p>
              {formatDuration(project.duration_seconds)} source · {project.candidates.length} distinct moments · {statusLabel(project.analysis_mode || "analysis")}
            </p>
          </div>
          <button
            className="delete-button"
            onClick={onDelete}
            title="Delete project and all local media"
            type="button"
          >
            <Icon size={18}>
              <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
            </Icon>
            Delete project
          </button>
        </div>

        {project.analysis_mode === "timeline-fallback" && (
          <div className="fallback-banner">
            <strong>Timeline suggestions are active.</strong>
            Local transcription was unavailable, so review the ranges and add captions before export.
          </div>
        )}

        {candidate ? (
          <div className="workspace-grid">
            <CandidateList onSelect={setSelectedId} project={project} selectedId={selectedId} />
            <ClipEditor
              candidate={candidate}
              key={candidate.id}
              onRender={render}
              onSave={save}
              project={project}
            />
          </div>
        ) : (
          <div className="empty-projects"><h3>No suitable moments were found.</h3></div>
        )}
      </main>
    </>
  );
}

function App() {
  const initialId = window.location.hash.startsWith("#project/")
    ? window.location.hash.slice("#project/".length)
    : null;
  const [projects, setProjects] = useState<Project[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const updateProject = (project: Project) => {
    setProjects((current) => {
      const exists = current.some((item) => item.id === project.id);
      return exists
        ? current.map((item) => (item.id === project.id ? project : item))
        : [project, ...current];
    });
  };

  const refresh = async (quiet = false) => {
    try {
      if (!quiet) setGlobalError(null);
      const next = await api.projects();
      setProjects(next);
    } catch (caught) {
      if (!quiet) {
        setGlobalError(caught instanceof Error ? caught.message : "ClipMine is unavailable.");
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([
      refresh(),
      api.config().then(setConfig).catch(() => setConfig(null)),
    ]);
    const interval = window.setInterval(() => void refresh(true), 2500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      setSelectedId(
        window.location.hash.startsWith("#project/")
          ? window.location.hash.slice("#project/".length)
          : null,
      );
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selected = useMemo(
    () => projects.find((project) => project.id === selectedId),
    [projects, selectedId],
  );

  const openProject = (id: string) => {
    window.location.hash = `project/${id}`;
    setSelectedId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goHome = () => {
    window.history.pushState(null, "", window.location.pathname);
    setSelectedId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const retry = async () => {
    if (!selected) return;
    try {
      updateProject(await api.retry(selected.id));
    } catch (caught) {
      setGlobalError(caught instanceof Error ? caught.message : "Could not retry project.");
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm("Delete this project, its source video and all rendered clips?")) return;
    try {
      await api.deleteProject(selected.id);
      setProjects((current) => current.filter((item) => item.id !== selected.id));
      goHome();
    } catch (caught) {
      setGlobalError(caught instanceof Error ? caught.message : "Could not delete project.");
    }
  };

  if (loading) {
    return (
      <div className="app-loading">
        <LogoMark />
        <span>Opening the mine…</span>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {globalError && (
        <div className="global-error" role="alert">
          <span>{globalError}</span>
          <button onClick={() => setGlobalError(null)} type="button">Dismiss</button>
        </div>
      )}
      {selected ? (
        <ProjectWorkspace
          onDelete={remove}
          onHome={goHome}
          onRetry={retry}
          onUpdate={updateProject}
          project={selected}
        />
      ) : (
        <>
          <AppHeader onHome={goHome} />
          <Dashboard
            config={config}
            onOpen={openProject}
            onUploaded={(project) => {
              updateProject(project);
              openProject(project.id);
            }}
            projects={projects}
          />
          <footer>
            <Brand />
            <p>Private-by-default video repurposing. Built for creator control.</p>
            <span>MVP 0.1</span>
          </footer>
        </>
      )}
    </div>
  );
}

export default App;
