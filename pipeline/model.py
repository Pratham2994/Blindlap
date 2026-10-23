"""Train and honestly evaluate the "who is driving?" model.

Each corner of a lap is one sample. A multinomial logistic regression turns a corner's style
features into P(driver | corner). A lap's guess is the product over corners (naive Bayes over
corners), softened by a temperature because corners of one lap are not independent.

Evaluation is leave-one-circuit-out: the model that guesses laps at Monza never saw Monza, in any year. The
browser uses exactly these per-session folds, so the game is as honest as the report.
"""
import json
import pickle
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression

from features import CORNER_CLASSES, FEATURES, expand

BUILD = Path(__file__).parent / "build"
MIN_SESSIONS = 4


def load_sessions():
    out = []
    for p in sorted(BUILD.glob("*.pkl")):
        out.append(pickle.loads(p.read_bytes()))
    out.sort(key=lambda d: d["session"]["date_start"])
    return out


def acronym(sess, num):
    return sess["drivers"][num]["name_acronym"]


def team(sess, num):
    return sess["drivers"][num]["team_name"]


def corner_rows(sess):
    """Rows for every (lap, corner): X (n x 24), lap index, label."""
    X, lap_idx, y = [], [], []
    for i, lap in enumerate(sess["laps"]):
        for c, cls in enumerate(sess["classes"]):
            X.append(expand(sess["z"][i, c], cls))
            lap_idx.append(i)
            y.append(acronym(sess, lap.driver))
    return np.array(X), np.array(lap_idx), np.array(y)


def lap_scores(proba_rows, lap_idx, n_laps):
    """Sum of log P(driver | corner) for each lap."""
    logp = np.log(np.clip(proba_rows, 1e-6, 1))
    out = np.zeros((n_laps, proba_rows.shape[1]))
    np.add.at(out, lap_idx, logp)
    return out


def softmax(a, tau):
    a = a / tau
    a = a - a.max(axis=1, keepdims=True)
    e = np.exp(a)
    return e / e.sum(axis=1, keepdims=True)


def evaluate(sessions, labels, make_model, name, keep_models=False):
    """Leave-one-circuit-out evaluation. Returns the report, the fitted fold models (only when
    keep_models, since tree ensembles are large) and every held-out probability, per session, as
    an array of laps x corners x classes, which the game replays instead of running the model."""
    per_session = []
    probs = {}
    all_scores, all_truth, all_team_truth, all_team_maps = [], [], [], []
    folds = {}
    # Leave one circuit out: every year of the held-out circuit leaves training together, so the
    # model never saw the track it is guessing on.
    circuit = lambda s: s["session"]["circuit_short_name"]
    rows = {s["session"]["session_key"]: corner_rows(s) for s in sessions}
    classes = None
    for c in sorted({circuit(s) for s in sessions}):
        Xtr, ytr = [], []
        for s in sessions:
            if circuit(s) == c:
                continue
            X, _, y = rows[s["session"]["session_key"]]
            m = np.isin(y, labels)
            Xtr.append(X[m]); ytr.append(y[m])
        model = make_model()
        model.fit(np.vstack(Xtr), np.concatenate(ytr))
        classes = classes or list(model.classes_)
        # Practice sessions only add training laps; every score is on qualifying.
        for held in [s for s in sessions if is_quali(s) and circuit(s) == c]:
            sk = held["session"]["session_key"]
            if keep_models:
                folds[sk] = model
            X, li, y = rows[sk]
            proba = model.predict_proba(X)
            probs[sk] = proba.reshape(len(held["laps"]), len(held["classes"]), -1).astype(np.float32)
            scores = lap_scores(proba, li, len(held["laps"]))
            truth = [acronym(held, l.driver) for l in held["laps"]]
            keep = np.array([t in labels for t in truth])
            all_scores.append(scores[keep])
            all_truth += [t for t, kk in zip(truth, keep) if kk]
            # Team of each candidate driver in this session (drivers can change team mid-season).
            tmap = {acronym(held, n): team(held, n) for n in held["drivers"]}
            all_team_maps += [tmap] * int(keep.sum())
            all_team_truth += [team(held, l.driver) for l, kk in zip(held["laps"], keep) if kk]
            label = f'{held["session"]["circuit_short_name"]} {held["session"]["date_start"][:4]}'
            per_session.append((label, scores[keep], [t for t, kk in zip(truth, keep) if kk]))

    S = np.vstack(all_scores)
    truth_idx = np.array([classes.index(t) for t in all_truth])

    # Temperature that minimises held-out log loss.
    best_tau, best_nll = 1.0, 1e9
    for tau in np.geomspace(0.5, 40, 60):
        P = softmax(S, tau)
        nll = -np.mean(np.log(P[np.arange(len(P)), truth_idx] + 1e-12))
        if nll < best_nll:
            best_tau, best_nll = float(tau), float(nll)
    P = softmax(S, best_tau)
    rank = (-P).argsort(axis=1)
    top1 = float(np.mean(rank[:, 0] == truth_idx))
    top3 = float(np.mean([t in r[:3] for t, r in zip(truth_idx, rank)]))

    # Team accuracy: sum driver probabilities by the team they drove for in that session.
    team_hits = 0
    for p, tmap, tt in zip(P, all_team_maps, all_team_truth):
        agg = defaultdict(float)
        for ci, c in enumerate(classes):
            if c in tmap:
                agg[tmap[c]] += p[ci]
        team_hits += max(agg, key=lambda k: agg[k]) == tt
    team_acc = team_hits / len(P)

    # Teammate test: given the car, pick between the two drivers of that team (chance 50%). This
    # isolates driving style from the car, which the other numbers cannot.
    mate_hits = mate_n = 0
    for p, tmap, truth, tt in zip(P, all_team_maps, all_truth, all_team_truth):
        pair = [c for c in classes if tmap.get(c) == tt]
        if len(pair) != 2 or truth not in pair:
            continue
        pick = max(pair, key=lambda c: p[classes.index(c)])
        mate_hits += pick == truth
        mate_n += 1
    teammate = mate_hits / mate_n if mate_n else None

    sess_acc = []
    for name_, sc, tr in per_session:
        if not tr:
            continue
        pr = softmax(sc, best_tau).argmax(axis=1)
        sess_acc.append({"circuit": name_, "top1": float(np.mean([classes[i] == t for i, t in zip(pr, tr)])), "laps": len(tr)})

    # Confusion between drivers (row = truth, column = top guess).
    conf = np.zeros((len(classes), len(classes)), dtype=int)
    for t, r in zip(truth_idx, rank[:, 0]):
        conf[t, r] += 1

    print(f"{name:>8}: laps={len(P)} top1={top1:.3f} top3={top3:.3f} team={team_acc:.3f} "
          f"teammate={teammate if teammate is None else round(teammate, 3)} ({mate_n} laps) tau={best_tau:.2f} nll={best_nll:.3f}")
    report = dict(name=name, top1=top1, top3=top3, team=team_acc, teammate=teammate, teammateLaps=mate_n,
                tau=best_tau, nll=best_nll, laps=len(P),
                  chance=1 / len(classes), classes=classes, sessions=sess_acc, confusion=conf.tolist())
    return report, folds, probs


def is_quali(sess) -> bool:
    return sess["session"]["session_name"] == "Qualifying"


def year(sess) -> int:
    return int(sess["session"]["date_start"][:4])


def cross_season(sessions, labels, tau):
    """Train on every 2025 session, guess every 2026 lap: does a driver's style survive new cars and
    new rules? Only drivers who raced both seasons can be scored; candidates are the drivers of each
    session the model knows."""
    train = [s for s in sessions if year(s) == 2025]
    test = [s for s in sessions if year(s) == 2026 and is_quali(s)]
    if not train or not test:
        return None
    X, y = [], []
    for s in train:
        Xs, _, ys = corner_rows(s)
        m = np.isin(ys, labels)
        X.append(Xs[m]); y.append(ys[m])
    model = LogisticRegression(C=0.1, max_iter=3000, class_weight="balanced").fit(np.vstack(X), np.concatenate(y))
    classes = list(model.classes_)
    hits1 = hits3 = team_hits = n = 0
    chance = 0.0
    drivers = set()
    for s in test:
        Xs, li, _ = corner_rows(s)
        scores = lap_scores(model.predict_proba(Xs), li, len(s["laps"]))
        present = [c for c in classes if c in {acronym(s, d) for d in s["drivers"]}]
        cols = [classes.index(c) for c in present]
        tmap = {acronym(s, d): team(s, d) for d in s["drivers"]}
        for i, lap in enumerate(s["laps"]):
            truth = acronym(s, lap.driver)
            if truth not in present:
                continue
            p = softmax(scores[i:i + 1, cols], tau)[0]
            order = [present[j] for j in np.argsort(-p)]
            hits1 += order[0] == truth
            hits3 += truth in order[:3]
            agg = defaultdict(float)
            for c, pc in zip(present, p):
                agg[tmap[c]] += pc
            team_hits += max(agg, key=lambda k: agg[k]) == tmap[truth]
            n += 1
            chance += 1 / len(present)
            drivers.add(truth)
    if not n:
        return None
    out = {"train": len(train), "test": len(test), "laps": n, "drivers": len(drivers),
           "top1": hits1 / n, "top3": hits3 / n, "team": team_hits / n, "chance": chance / n}
    print(f"   cross: 2025 -> 2026 laps={n} top1={out['top1']:.3f} top3={out['top3']:.3f} team={out['team']:.3f}")
    return out


def main():
    sessions = load_sessions()
    counts = Counter()
    for s in sessions:
        counts.update({acronym(s, l.driver) for l in s["laps"]})
    labels = sorted(d for d, c in counts.items() if c >= MIN_SESSIONS)
    print(f"{len(sessions)} sessions, {len(labels)} drivers: {' '.join(labels)}")

    # Three models, same features, same held-out test. Logistic regression is the readable
    # baseline; random forest and gradient-boosted trees were the strongest of the tree ensembles
    # tried (extra-trees ran out of memory at a size that could match them).
    candidates = {
        "logreg": lambda: LogisticRegression(C=0.1, max_iter=3000, class_weight="balanced"),
        "forest": lambda: RandomForestClassifier(n_estimators=300, min_samples_leaf=3, max_features="sqrt",
                                                 class_weight="balanced_subsample", n_jobs=-1, random_state=0),
        "gbm": lambda: HistGradientBoostingClassifier(max_iter=150, learning_rate=0.06, max_leaf_nodes=15,
                                                      class_weight="balanced", random_state=0),
    }
    results, probs, lr_folds = {}, {}, {}
    for name, make in candidates.items():
        report, folds, held = evaluate(sessions, labels, make, name, keep_models=name == "logreg")
        results[name] = report
        probs[name] = held
        if name == "logreg":
            lr_folds = folds
            lr_report = report
    cross = cross_season(sessions, labels, lr_report["tau"])
    if cross:
        results["crossSeason"] = cross

    out = Path(__file__).parent / "model_out"
    out.mkdir(exist_ok=True)
    (out / "report.json").write_text(json.dumps(results, indent=1))
    weights = {
        str(sk): {"W": np.round(m.coef_, 4).tolist(), "b": np.round(m.intercept_, 4).tolist(), "classes": list(m.classes_)}
        for sk, m in lr_folds.items()
    }
    (out / "probs.pkl").write_bytes(pickle.dumps({
        "probs": probs, "classes": results["logreg"]["classes"],
        "tau": {k: v["tau"] for k, v in results.items() if k in candidates},
    }))
    (out / "folds.pkl").write_bytes(pickle.dumps({"weights": weights, "tau": lr_report["tau"], "labels": labels,
                                                 "features": FEATURES, "corner_classes": CORNER_CLASSES}))


if __name__ == "__main__":
    main()
