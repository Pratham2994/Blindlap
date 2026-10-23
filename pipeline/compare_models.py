"""Which models fit this data best? Every candidate gets the same leave-one-circuit-out test as
model.py, and the same metrics, so the numbers compare directly with the shipped three.

Candidates:
- corner models (one guess per corner, laps combine corners naive-Bayes style): logistic
  regression, random forest, boosted trees (current and tuned), a small neural net (MLP);
- a lap model: at every corner it sees the running mean of the lap so far, per corner class, so
  it learns how habits combine instead of multiplying corners as if they were independent;
- ensembles: corner models averaged in log space.

Run: .venv/Scripts/python.exe compare_models.py   (writes model_out/compare.json)
"""
import json
import pickle
import time
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from features import CORNER_CLASSES, FEATURES
from model import MIN_SESSIONS, acronym, evaluate, is_quali, lap_scores, load_sessions, softmax, team

OUT = Path(__file__).parent / "model_out"
NF = len(FEATURES)
NC = len(CORNER_CLASSES)


def score(name, per_session, classes, labels):
    """Metrics for lap scores (log space), per held-out session: {sk: (scores laps x classes, sess)}."""
    S, truth, tmaps, tteams = [], [], [], []
    for sc, sess in per_session.values():
        tr = [acronym(sess, l.driver) for l in sess["laps"]]
        keep = np.array([t in labels for t in tr])
        S.append(sc[keep])
        truth += [t for t, k in zip(tr, keep) if k]
        tm = {acronym(sess, n): team(sess, n) for n in sess["drivers"]}
        tmaps += [tm] * int(keep.sum())
        tteams += [team(sess, l.driver) for l, k in zip(sess["laps"], keep) if k]
    S = np.vstack(S)
    ti = np.array([classes.index(t) for t in truth])
    best = (1.0, 1e9)
    for tau in np.geomspace(0.2, 40, 80):
        P = softmax(S, tau)
        nll = -np.mean(np.log(P[np.arange(len(P)), ti] + 1e-12))
        if nll < best[1]:
            best = (float(tau), float(nll))
    P = softmax(S, best[0])
    rank = (-P).argsort(axis=1)
    top1 = float(np.mean(rank[:, 0] == ti))
    top3 = float(np.mean([t in r[:3] for t, r in zip(ti, rank)]))
    team_hits = mate_hits = mate_n = 0
    for p, tm, t, tt in zip(P, tmaps, truth, tteams):
        agg = defaultdict(float)
        for ci, c in enumerate(classes):
            if c in tm:
                agg[tm[c]] += p[ci]
        team_hits += max(agg, key=lambda k: agg[k]) == tt
        pair = [c for c in classes if tm.get(c) == tt]
        if len(pair) == 2 and t in pair:
            mate_hits += max(pair, key=lambda c: p[classes.index(c)]) == t
            mate_n += 1
    r = dict(name=name, top1=top1, top3=top3, team=team_hits / len(P), teammate=mate_hits / mate_n,
             nll=best[1], tau=best[0], laps=len(P))
    print(f"{name:>22}: top1={top1:.3f} top3={top3:.3f} team={r['team']:.3f} mate={r['teammate']:.3f} nll={r['nll']:.3f}",
          flush=True)
    return r, P


def corner_candidate(sessions, labels, make, name, by_key):
    t = time.time()
    _, _, probs = evaluate(sessions, labels, make, name)
    per = {}
    for sk, pr in probs.items():
        n_laps, n_c, k = pr.shape
        li = np.repeat(np.arange(n_laps), n_c)
        per[sk] = (lap_scores(pr.reshape(-1, k), li, n_laps), by_key[sk])
    print(f"   ({time.time() - t:.0f} s)", flush=True)
    return probs, per


def prefix_rows(sess):
    """For every lap and every corner c: the running mean of each corner class's 10 features over
    corners 0..c (zeros where a class has not appeared yet), plus how many of each class so far."""
    z = np.nan_to_num(sess["z"])  # laps x corners x features
    cls = np.array([CORNER_CLASSES.index(c) if isinstance(c, str) else int(c) for c in sess["classes"]])
    n_laps, n_c, _ = z.shape
    onehot = np.eye(NC)[cls]  # corners x classes
    sums = np.einsum("lcf,ck->lckf", z, onehot).cumsum(axis=1)  # laps x corners x classes x features
    counts = onehot.cumsum(axis=0)  # corners x classes
    means = sums / np.maximum(counts, 1)[None, :, :, None]
    X = np.concatenate([means.reshape(n_laps, n_c, NC * NF), np.broadcast_to(counts / n_c, (n_laps, n_c, NC))], axis=2)
    y = np.array([acronym(sess, l.driver) for l in sess["laps"]])
    return X.astype(np.float32), y


def lap_candidate(sessions, labels, make, name, by_key):
    """Leave-one-circuit-out for the prefix model. Its per-corner output is the full log P of the
    lap so far, so the lap score is simply the last corner's."""
    t = time.time()
    circuit = lambda s: s["session"]["circuit_short_name"]
    rows = {s["session"]["session_key"]: prefix_rows(s) for s in sessions}
    per, steps, classes = {}, {}, None
    for c in sorted({circuit(s) for s in sessions}):
        Xtr, ytr = [], []
        for s in sessions:
            if circuit(s) == c:
                continue
            X, y = rows[s["session"]["session_key"]]
            m = np.isin(y, labels)
            # Every prefix is a training row, so the model learns to guess from part of a lap.
            Xtr.append(X[m].reshape(-1, X.shape[2]))
            ytr.append(np.repeat(y[m], X.shape[1]))
        model = make().fit(np.vstack(Xtr), np.concatenate(ytr))
        classes = classes or list(model.classes_)
        for held in [s for s in sessions if is_quali(s) and circuit(s) == c]:
            sk = held["session"]["session_key"]
            X, _ = rows[sk]
            pr = model.predict_proba(X.reshape(-1, X.shape[2])).reshape(X.shape[0], X.shape[1], -1)
            logp = np.log(np.clip(pr, 1e-6, 1))
            steps[sk] = logp
            per[sk] = (logp[:, -1, :], by_key[sk])
    print(f"   {name} ({time.time() - t:.0f} s)", flush=True)
    return steps, per, classes


def main():
    sessions = load_sessions()
    counts = Counter()
    for s in sessions:
        counts.update({acronym(s, l.driver) for l in s["laps"]})
    labels = sorted(d for d, c in counts.items() if c >= MIN_SESSIONS)
    by_key = {s["session"]["session_key"]: s for s in sessions}
    shipped = pickle.loads((OUT / "probs.pkl").read_bytes())
    classes = shipped["classes"]
    results, per_all = {}, {}

    # The shipped three, rescored from their saved held-out probabilities (no retraining).
    for name in ("logreg", "forest", "gbm"):
        per = {}
        for sk, pr in shipped["probs"][name].items():
            n_laps, n_c, k = pr.shape
            per[sk] = (lap_scores(pr.reshape(-1, k), np.repeat(np.arange(n_laps), n_c), n_laps), by_key[sk])
        per_all[name] = per
        results[name], _ = score(name, per, classes, labels)

    new = {
        "gbm_tuned": lambda: HistGradientBoostingClassifier(max_iter=400, learning_rate=0.04, max_leaf_nodes=24,
                                                            min_samples_leaf=40, l2_regularization=1.0,
                                                            class_weight="balanced", random_state=0),
        "mlp": lambda: make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(128, 64), alpha=3e-3,
                                                                     batch_size=512, learning_rate_init=2e-3,
                                                                     early_stopping=True, max_iter=200, random_state=0)),
    }
    corner_probs = {}
    for name, make in new.items():
        corner_probs[name], per_all[name] = corner_candidate(sessions, labels, make, name, by_key)
        results[name], _ = score(name, per_all[name], classes, labels)

    lap_models = {
        "lap_gbm": lambda: HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, max_leaf_nodes=24,
                                                          min_samples_leaf=60, l2_regularization=1.0,
                                                          class_weight="balanced", random_state=0),
        "lap_mlp": lambda: make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(128, 64), alpha=1e-2,
                                                                         batch_size=512, early_stopping=True,
                                                                         max_iter=200, random_state=0)),
    }
    lap_steps = {}
    for name, make in lap_models.items():
        lap_steps[name], per_all[name], lc = lap_candidate(sessions, labels, make, name, by_key)
        assert lc == classes, "class order differs"
        results[name], _ = score(name, per_all[name], classes, labels)

    # Ensembles: average lap scores after putting each model on its own fitted temperature.
    def blend(names):
        per = {}
        for sk in per_all[names[0]]:
            per[sk] = (sum(per_all[n][sk][0] / results[n]["tau"] for n in names) / len(names), by_key[sk])
        return per

    for names in (["gbm", "forest"], ["gbm", "mlp"], ["gbm", "lap_gbm"], ["gbm", "mlp", "lap_gbm"],
                  ["gbm", "forest", "logreg"], ["gbm_tuned", "mlp", "lap_gbm", "forest"]):
        if all(n in per_all for n in names):
            name = "blend:" + "+".join(names)
            results[name], _ = score(name, blend(names), classes, labels)

    (OUT / "compare.json").write_text(json.dumps(results, indent=1))
    (OUT / "compare_probs.pkl").write_bytes(pickle.dumps({"corner": corner_probs, "lap": lap_steps, "classes": classes}))
    print("wrote", OUT / "compare.json")


if __name__ == "__main__":
    main()
