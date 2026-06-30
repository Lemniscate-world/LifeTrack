# SPEC — Habit Stacking (Phase 6)

## Objectif

Permettre à un utilisateur de lier des habitudes en chaînes : "after coffee → meditate"
(et plus généralement, une habitude peut déclencher N enfants). Suivre la
progression de chaque routine et suggérer la prochaine action contextuelle.

Inspiré de :
- "Atomic Habits" (James Clear) — concept central du livre
- Habitica "challenges" (sans la game-ification)
- Loop "reminder anchoring" — ancre contextuelle

---

## Modèle de données

### Champ Habit (nouveau)

```
Habit {
  ...existants
  stackParent?: string  // habitId du parent, ou undefined
}
```

Graphe orienté : un parent → N enfants. Pas de cycle (validation : un enfant ne
peut pas avoir un parent qui le descend transitivement).

### Propagation de cascade (calculée, non stockée)

À chaque check-in, recalculer pour chaque enfant :
- si parent non fait aujourd'hui → état `blocked`
- si parent fait et enfant fait → `done`
- si parent fait et enfant non fait (ou explicit false) → `pending`

---

## API store (nouvelles fonctions)

| Fonction | Signature | Effet |
|---|---|---|
| `linkHabitToParent(habitId, parentId)` | `(string, string) => void` | Définit `stackParent`. Cycle check : refuse si parentId descend de habitId. |
| `unlinkHabitFromParent(habitId)` | `(string) => void` | Retire `stackParent`. |
| `getStacks(today)` | `(Date) => StackStatus[]` | Calcule l'état de chaque stack aujourd'hui. |
| `getStackForHabit(habitId, today)` | `(string, Date) => StackStatus` | Vue par habitude (pour le bottom-bar "suggestion"). |
| `validateNoCycle(habitId, parentId)` | `(string, string) => boolean` | DFS pour détecter cycle, retourne `true` si OK. |

### Type StackStatus

```
interface StackStep {
  habitId: string;
  habitName: string;
  habitColor: string;
  state: 'done' | 'pending' | 'blocked' | 'untracked';
}

interface StackStatus {
  rootId: string;
  rootName: string;
  steps: StackStep[]; // [root, child1, child2, ...]
  doneCount: number;
  pendingCount: number;
  blockedCount: number;
  completionPct: number; // 0-100
}
```

---

## UI

### A. Éditeur d'habitude

Dans le menu existant "Click to rename", ajouter aussi un dropdown :
- "Stack parent: (none)"
- Liste des autres habitudes (archivées exclues)

Si on sélectionne un parent, le dropdown se ferme et un badge `↳ after: <parent>`
apparaît à côté du nom.

### B. Grid view — badge inline

À gauche du nom de l'habitude, si `stackParent`, afficher :
- Petit badge `↳ <parent name>` cliquable (hover → highlight le parent dans la grid)
- Couleur : neutre (var(--text-muted))

Pas d'indentation — on garde les habitudes à plat. Le badge suffit à transmettre
la relation.

### C. Vue Stacks dédiée (nouveau tab)

`view: 'grid' | 'stats' | 'history' | 'stacks' | 'chaos'`

Pour chaque stack détecté (chaque habitude qui a au moins un enfant) :
- Nom du stack = nom de la racine
- Liste verticale : racine + enfants dans l'ordre alphabétique
- Pour chaque step : badge d'état (✓ done / • pending / ⊘ blocked / ? untracked)
- Barre de progression : `doneCount / totalCount`
- Si 100% fait : message "Stack complete for today — nice work!"

État vide : "Create a stack by linking one habit as another habit's parent."

### D. Suggestion contextuelle (bottom-bar)

À côté du bouton "+ New Habit", afficher le bouton dynamique :
- "Next: <habit name>" quand une habitude est `pending` dans un stack root `done`
- Visible seulement quand une suggestion existe (sinon masqué)
- Cliquer → bascule `view` vers `grid` ET focus la cellule du jour de l'habitude

---

## Edge cases à tester

| # | Cas | Comportement attendu |
|---|---|---|
| 1 | Parent archivé | Cascade désactivée, children deviennent `untracked` |
| 2 | Parent supprimé | `stackParent` devient undefined pour tous les enfants (auto-fix) |
| 3 | Cycle tenté | Refus silencieux + console.warn |
| 4 | Aucun check-in aujourd'hui pour parent | Tous les enfants = `blocked` |
| 5 | Parent coché aujourd'hui, enfant non touché | Enfant = `pending` |
| 6 | Parent fait hier seulement (pas aujourd'hui) | Enfant = `blocked` |
| 7 | 3-niveau chaîne (A → B → C) | A blocker → B blocked ET C blocked |
| 8 | Enfant archivé | Exclu du stack status mais lien préservé |
| 9 | Reload page après link | État persisté, parents non-archivés ont `parent` champ set |
| 10 | Habit avec parent mais parent introuvable | Console.warn + auto-clear |

---

## Hors-scope (pas ce sprint)

- Templates de routines pré-définis (Phase 6 point 3 du ROADMAP)
- Chaos amplification pour stacks (Phase 6 point 4)
- Drag-and-drop dans la vue Stacks pour réordonner
- Export CSV des stacks

---

## Estimation effort

| Étape | LoC | Tests |
|---|---|---|
| Champ `stackParent` + sanitize + import | ~30 | 4 |
| `linkHabitToParent`, `unlinkHabitFromParent`, cycle check | ~70 | 6 |
| `getStacks`, `getStackForHabit` | ~80 | 8 |
| UI sélecteur parent | ~50 | 3 |
| UI badge inline | ~30 | 2 |
| UI vue Stacks | ~100 | 5 |
| UI suggestion contextuelle | ~50 | 3 |
| **Total** | **~410** | **~31** |
