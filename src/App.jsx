import React, { useEffect, useState } from "react";

const NUMBERS = Array.from({ length: 100 }, (_, index) => index + 1);
const BASE_URL = import.meta.env.BASE_URL;

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
  const [notice, setNotice] = useState("");
  const [loadingError, setLoadingError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reload, setReload] = useState(0);
  const mode = state?.mode;
  const myVote = state?.myVote ?? null;
  const counts = state?.counts ?? {};
  const winner = state?.winner ?? null;

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
    if (submitting) return;
    setSubmitting(true);
    setNotice("");
    try {
      const data = await requestState({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: selectedNumber }),
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
        )}
        {notice && <p className="notice" role="alert">{notice}</p>}

        <div
          className={`number-grid ${mode === "resultats" ? "results-grid" : ""}`}
          role="group"
          aria-label="Numbers from 1 to 100"
        >
          {NUMBERS.map((number) => {
            const count = counts[number] ?? 0;
            const isWinner = mode === "resultats" && winner === number;
            const isChosen = selectedNumber === number;
            const isMyVote = myVote === number;
            return (
              <button
                type="button"
                key={number}
                className={[
                  "number-cell",
                  isChosen ? "selected" : "",
                  isMyVote && mode === "sondage" ? "my-vote" : "",
                  isWinner ? "winner" : "",
                  mode === "resultats" && count > 0 && !isWinner ? "has-votes" : "",
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
                    ? `${number}: ${count} ${count === 1 ? "vote" : "votes"}${isWinner ? ", winning number" : ""}`
                    : `Choose ${number}${isMyVote ? ", your vote" : ""}`
                }
              >
                <span className="cell-number">{number}</span>
                {mode === "resultats" && <span className="cell-count">{count}</span>}
              </button>
            );
          })}
        </div>

        {mode === "resultats" && (
          <div className={`result-banner ${winner ? "has-winner" : ""}`} aria-live="polite">
            <span className="result-symbol">{winner ? "✳" : "—"}</span>
            <div>
              <p className="result-label">{winner ? "THE WINNING NUMBER" : "NO WINNER"}</p>
              <p className="result-title">
                {winner ? <><strong>{winner}</strong> <span>— picked exactly once</span></> : "No number was picked exactly once"}
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
