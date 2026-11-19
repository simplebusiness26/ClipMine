import { useEffect, useState } from "react";
import ClipMine from "./App";
import { call, type Niche } from "./niches-api";

const phoneStudioUrl =
  "https://colab.research.google.com/drive/1FQatg88WooJV2YI7TUwtZjCwzTgqoZbb";

export default function ClipMineStudio({
  niches,
  changed,
}: {
  niches: Niche[];
  changed: () => void;
}) {
  const [hostedAvailable, setHostedAvailable] = useState(false);
  const [hostNicheId, setHostNicheId] = useState("");

  useEffect(() => {
    let active = true;
    void call<{ clipmine_available: boolean }>("/api/config")
      .then((config) => {
        if (active) setHostedAvailable(config.clipmine_available);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const hostNiche = niches.find((niche) => niche.id === hostNicheId);

  return (
    <div className="clipmine-page">
      <section className="clipmine-launch" aria-labelledby="clipmine-heading">
        <div className="clipmine-launch__content">
          <h1 id="clipmine-heading">ClipMine</h1>
          <p>Turn a long video into short, vertical clips.</p>
          <a
            className="clipmine-button"
            href={phoneStudioUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby="clipmine-opens-colab"
          >
            Open Phone Studio
          </a>
          <span id="clipmine-opens-colab" className="clipmine-help">
            Opens Google Colab in a new tab
          </span>
        </div>
        <div className="clipmine-launch__art" aria-hidden="true">
          <div className="clipmine-film">
            <span /><span /><span /><span /><span />
          </div>
          <div className="clipmine-frame"><span /></div>
        </div>
      </section>

      <ol className="clipmine-steps" aria-label="From source video to draft">
        <li>
          <h2>Add a video</h2>
          <p>Upload a video from your phone or paste a supported source link in Colab.</p>
        </li>
        <li>
          <h2>Review your clips</h2>
          <p>Choose Best bits or Numbered parts, set the count and length, then play the clips you get.</p>
        </li>
        <li>
          <h2>Save to Niches</h2>
          <p>Send a clip from Colab, then choose the Instagram account and save the draft in Niches.</p>
        </li>
      </ol>

      {hostedAvailable && niches.length > 0 && (
        <details className="clipmine-hosted">
          <summary>Use the hosted editor</summary>
          <div className="clipmine-hosted__body">
            <label className="clipmine-field">
              Choose a niche for your project
              <select value={hostNicheId} onChange={(event) => setHostNicheId(event.target.value)}>
                <option value="">Select a niche</option>
                {niches.map((niche) => (
                  <option key={niche.id} value={niche.id}>{niche.name}</option>
                ))}
              </select>
            </label>
            {hostNiche && (
              <div className="n-studio">
                <ClipMine key={hostNiche.id} nicheId={hostNiche.id} onSent={changed} />
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
