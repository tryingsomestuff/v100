import React, { useEffect, useLayoutEffect, useState } from "react";

const NUMBERS = Array.from({ length: 100 }, (_, index) => index + 1);
const BASE_URL = import.meta.env.BASE_URL;

function revealDelay(total) {
  return Math.min(900, Math.max(120, Math.round(12000 / Math.max(total, 1))));
}

async function requestState(options = {}) {
  const response = await fetch(`${BASE_URL}${options.method === "POST" ? "api/votes" : "api/state"}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Unable to reach the server.");
  }
  return data;
}

function App() {
  const [state, setState] = useState(null);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [participantName, setParticipantName] = useState("");
  const [notice, setNotice] = useState("");
  const [loadingError, setLoadingError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reload, setReload] = useState(0);
  const mode = state?.mode;
  const myVote = state?.myVote ?? null;
  const myName = state?.myName ?? "";
  const counts = state?.counts ?? {};
  const winner = state?.winner ?? null;
  const winnerName = state?.winnerName ?? null;
  const sequence = state?.sequence ?? [];
  const [step, setStep] = useState(null);
  const [playing, setPlaying] = useState(false);
  const replayDone = step === null || step >= sequence.length;
  const replayCounts = {};
  if (!replayDone) {
    for (const number of sequence.slice(0, step)) replayCounts[number] = (replayCounts[number] ?? 0) + 1;
  }
  const shownCounts = replayDone ? counts : replayCounts;
  const leader = replayDone ? winner : NUMBERS.find((number) => replayCounts[number] === 1) ?? null;
  const lastRevealed = !replayDone && step > 0 ? sequence[step - 1] : null;

  useLayoutEffect(() => {
    if (mode !== "resultats" || step !== null) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setStep(reducedMotion ? sequence.length : 0);
    setPlaying(!reducedMotion && sequence.length > 0);
  }, [mode, step, sequence.length]);

  useEffect(() => {
    if (!playing) return undefined;
    if (step >= sequence.length) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => setStep((value) => value + 1), revealDelay(sequence.length));
    return () => clearTimeout(timer);
  }, [playing, step, sequence.length]);

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const data = await requestState({ signal: controller.signal });
        if (!controller.signal.aborted) {
          setState(data);
          setLoadingError("");
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Unable to load the poll:", error);
          setLoadingError("Unable to load the poll. Check your connection to the server.");
        }
      }
    }
    refresh();
    const interval = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [reload]);

  async function submitVote() {
    if (!selectedNumber) {
      setNotice("Choose a number before confirming your vote.");
      return;
    }
    if (!participantName.trim()) {
      setNotice("Enter your name before confirming your vote.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setNotice("");
    try {
      const data = await requestState({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: selectedNumber, name: participantName.trim() }),
      });
      setState(data);
      setLoadingError("");
    } catch (error) {
      console.error("Unable to save the vote:", error);
      setNotice(`Vote not confirmed: ${error.message}`);
      setReload((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href={BASE_URL} aria-label="Vote 100, home">
          <span className="brand-mark">V<span>100</span></span>
          <span className="brand-name">THE WINNING<br />NUMBER</span>
        </a>
        {state && <span className="mode-status">{mode === "resultats" ? "Results" : "Voting open"}</span>}
      </header>

      <div className="content-layout">
      <section className="intro">
        <div className="eyebrow"><span className="eyebrow-dot" /> A GAME OF STRATEGY</div>
        <h1>
          {mode === "resultats" ? (
            <>The results.<span>Revealed.</span></>
          ) : (
            <>One number.<span>One chance.</span></>
          )}
        </h1>
        <p className="intro-copy">
          {mode === "resultats"
            ? "The lowest number picked exactly once wins. See how everyone voted."
            : "Pick a number from 1 to 100. The lowest number picked exactly once wins."}
        </p>
        <div className="experiment-note">
          <h2>Why this experiment?</h2>
          <p>This experiment explores strategic thinking: can you anticipate others’ choices and find a low, unique number?</p>
        </div>
        <div className="rule-note">
          <span className="rule-icon" aria-hidden="true">↘</span>
          <span>One vote per browser. Make it count.</span>
        </div>
      </section>

      {!state ? (
        <section className="game-card">
          {loadingError && <p className="notice" role="alert">{loadingError}</p>}
          {loadingError ? (
            <button className="submit-button" type="button" onClick={() => setReload((value) => value + 1)}>Try again</button>
          ) : <p role="status">Loading the poll…</p>}
        </section>
      ) : <section className="game-card" aria-label={mode === "resultats" ? "Voting results" : "Voting grid"}>
        {loadingError && <p className="notice" role="alert">{loadingError}</p>}
        <div className="card-heading">
          <div>
            <p className="section-kicker">{mode === "resultats" ? "THE REVEAL" : "YOUR TURN"}</p>
            <h2>{mode === "resultats" ? "How everyone voted" : "Your number"}</h2>
          </div>
          <div className="total-pill">
            <span className="total-number">{state.total}</span>
            <span>{state.total === 1 ? "vote" : "votes"}</span>
          </div>
        </div>

        {mode === "sondage" && (
          <div className="vote-entry">
            {myVote === null ? (
              <label className="name-field">
                <span>Your name</span>
                <input
                  type="text"
                  value={participantName}
                  onChange={(event) => setParticipantName(event.target.value)}
                  maxLength={40}
                  autoComplete="nickname"
                  placeholder="Enter a name"
                  disabled={submitting || Boolean(loadingError)}
                  required
                />
              </label>
            ) : (
              <p className="voter-name"><span>Your name</span><strong>{myName || "Anonymous"}</strong></p>
            )}
            <div className="vote-controls">
              <div className="selection-summary" aria-live="polite">
                {myVote !== null ? (
                  <><span className="status-icon">✓</span> Your vote: <strong>{myVote}</strong></>
                ) : selectedNumber !== null ? (
                  <>Your choice: <strong>{selectedNumber}</strong></>
                ) : (
                  <span className="muted">Choose a number below</span>
                )}
              </div>
              {myVote === null && (
              <button className="submit-button" type="button" onClick={submitVote} disabled={submitting || Boolean(loadingError)}>
                {submitting ? "Saving…" : "Confirm my vote"} <span aria-hidden="true">↗</span>
              </button>
              )}
            </div>
          </div>
        )}
        {notice && <p className="notice" role="alert">{notice}</p>}

        {mode === "resultats" && sequence.length > 0 && (
          <div className="replay-controls">
            <span className="replay-progress">
              Vote <strong>{Math.min(step ?? sequence.length, sequence.length)}</strong> / {sequence.length}
            </span>
            <div className="replay-buttons">
              {replayDone ? (
                <button type="button" className="replay-button" onClick={() => { setStep(0); setPlaying(true); }}>
                  Replay the count
                </button>
              ) : (
                <>
                  <button type="button" className="replay-button" onClick={() => setPlaying((value) => !value)}>
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button type="button" className="replay-button" onClick={() => { setStep(sequence.length); setPlaying(false); }}>
                    Skip to result
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div
          className={`number-grid ${mode === "resultats" ? "results-grid" : ""}`}
          role="group"
          aria-label="Numbers from 1 to 100"
        >
          {NUMBERS.map((number) => {
            const count = shownCounts[number] ?? 0;
            const isWinner = mode === "resultats" && leader === number;
            const isChosen = selectedNumber === number;
            const isMyVote = myVote === number;
            return (
              <button
                type="button"
                key={lastRevealed === number ? `${number}-${step}` : number}
                className={[
                  "number-cell",
                  isChosen ? "selected" : "",
                  isMyVote && mode === "sondage" ? "my-vote" : "",
                  isWinner ? "winner" : "",
                  mode === "resultats" && count > 0 && !isWinner ? "has-votes" : "",
                  lastRevealed === number ? "just-voted" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  if (mode === "sondage" && myVote === null && !submitting && !loadingError) {
                    setSelectedNumber(number);
                    setNotice("");
                  }
                }}
                disabled={mode === "resultats" || myVote !== null || submitting || Boolean(loadingError)}
                aria-pressed={mode === "sondage" ? isChosen : undefined}
                aria-label={
                  mode === "resultats"
                    ? `${number}: ${count} ${count === 1 ? "vote" : "votes"}${isWinner ? (replayDone ? ", winning number" : ", provisional leader") : ""}`
                    : `Choose ${number}${isMyVote ? ", your vote" : ""}`
                }
              >
                <span className="cell-number">{number}</span>
                {mode === "resultats" && <span className="cell-count">{count}</span>}
              </button>
            );
          })}
        </div>

        {mode === "resultats" && !replayDone && (
          <div className={`result-banner provisional ${leader ? "has-winner" : ""}`}>
            <span className="result-symbol">{leader ? "…" : "—"}</span>
            <div>
              <p className="result-label">{leader ? "PROVISIONAL LEADER" : "NO LEADER YET"}</p>
              <p className="result-title">
                {leader ? <><strong>{leader}</strong><span>Lowest unique number so far</span></> : "No number picked exactly once so far"}
              </p>
            </div>
          </div>
        )}

        {mode === "resultats" && replayDone && (
          <div className={`result-banner ${winner ? "has-winner" : ""}`} aria-live="polite">
            <span className="result-symbol">{winner ? "✳" : "—"}</span>
            <div>
              <p className="result-label">{winner ? "THE WINNING NUMBER" : "NO WINNER"}</p>
              <p className="result-title">
                {winner ? <><strong>{winnerName || "Anonymous"}</strong><span>Won with number {winner}</span></> : "No number was picked exactly once"}
              </p>
            </div>
            {winner && <span className="winner-tag">1 vote</span>}
          </div>
        )}

      </section>}
      </div>

      <footer className="page-footer">
        <span>VOTE 100 <span className="footer-dot">·</span> THE LOWEST UNIQUE NUMBER</span>
        <span>{mode === "resultats" ? "Each cell shows its vote count." : "Your choice stays secret until the reveal."}</span>
      </footer>
    </main>
  );
}

export default App;
