# Design Spec — Lisibilité de Principles dans Chaos

## Contexte

`PrinciplesView` et `PrincipleTriggersPanel` existent deja et sont fonctionnels, mais la lecture reste trop proche d'un panneau utilitaire. La densite est correcte, pourtant la hierarchie visuelle ne guide pas assez bien l'oeil entre :

- la dimension Chaos,
- les principes actifs ou au repos,
- les routines fixes,
- les reflexions liees.

Le besoin valide avec l'utilisateur est de **continuer l'amelioration du design en priorisant la lisibilite**, sans transformer l'ecran en dashboard lourd ni ajouter de nouvelles features.

## Objectif

Rendre l'ecran `Principles` plus rapide a scanner et plus calme a lire, de sorte qu'un utilisateur comprenne en quelques secondes :

1. quelle dimension il regarde,
2. quels principes sont actifs,
3. ou agir maintenant,
4. quels contenus sont secondaires.

## Non-objectifs

- Aucune nouvelle feature produit.
- Aucun changement de logique metier sur les triggers, routines ou reflexions.
- Aucun style decoratif en rupture avec `Quiet Precision`.
- Aucun redesign global de `ChaosView`.

## Principes de design retenus

### 1. Hierarchie par niveaux d'attention

Chaque carte de dimension doit etre lue dans cet ordre :

1. **Dimension**
2. **Etat de la dimension**
3. **Principes**
4. **Routines**
5. **Reflexions**

Les principes sont le contenu primaire. Les routines sont du support d'action. Les reflexions sont du contexte.

### 2. Structure plus nette, pas plus spectaculaire

Le redesign suit `Quiet Precision` :

- accents de couleur limites au role de donnee,
- bordures et separations structurelles discretes,
- pas de gradient decoratif,
- pas de glow,
- pas de side-tab epaisse,
- contraste clair entre primaire et secondaire.

### 3. Interaction calme

Les formulaires inline doivent rester disponibles sans casser la lecture de la liste. Quand aucun formulaire n'est ouvert, la vue doit ressembler d'abord a une surface de lecture, pas a une surface d'administration.

## Architecture UI cible

### Niveau 1 — Carte de dimension

Chaque `section.principles-dim` devient une carte lisible en 3 etages :

1. **Header**
   - nom de la dimension,
   - accent discret,
   - compteur de principes.

2. **Resume de surface**
   - nombre de principes actifs,
   - nombre de routines disponibles,
   - formulation courte, directement scannable.

3. **Corps**
   - panel des principes,
   - puis reflexions liees, si presentes.

Le resume doit etre court et purement informatif. Aucun jargon ni phrase longue.

### Niveau 2 — Principe

Chaque principe devient une unite primaire stable avec l'ordre visuel suivant :

`checkbox -> label -> impact -> etat`

Contraintes :

- le label reste l'element dominant,
- l'impact devient secondaire mais toujours visible,
- l'etat `actif` / `repos` doit etre identifiable instantanement,
- l'etat actif gagne un fond legerement plus present, sans sur-accent decoratif.

### Niveau 3 — Routine

Les routines sont retrogradees au second plan visuel :

- bloc plus leger que le principe,
- contraste plus faible,
- titre utile mais discret,
- steps faciles a lire sans voler l'attention.

L'action `+ Routine fixe` reste inline sous le principe concerne, mais elle doit se lire comme une action secondaire.

### Niveau 4 — Reflexion

Les reflexions liees restent visibles uniquement comme contexte :

- apercu court,
- badge de statut lisible,
- contraste modere,
- aucune concurrence avec les principes.

## Changements de presentation attendus

### Dans `PrinciplesView.tsx`

- Ajouter un petit resume par dimension entre le header et le panel.
- Mieux separer visuellement le panel de principes et le bloc de reflexions.
- Renforcer la lisibilite du header de dimension, sans surcharge.

### Dans `PrincipleTriggersPanel.tsx`

- Rendre chaque principe plus compact et plus stable visuellement.
- Clarifier l'etat actif vs repos.
- Faire descendre visuellement les routines sous le principe.
- Faire descendre encore d'un cran les formulaires inline.
- Garder l'ajout de principe comme action de fin de carte, calme et structuree.

### Dans `App.css`

Le travail CSS doit surtout porter sur :

- espacements verticaux,
- niveaux de contraste,
- bordures internes,
- etats de surface,
- densite de lecture mobile et desktop,
- coherence avec les tokens et les conventions `Quiet Precision`.

Le CSS doit preferer des styles structurels et semantiques a des effets "premium" artificiels.

## Comportement conserve

Le redesign ne modifie pas :

- `toggleChaosTrigger`,
- `addChaosTrigger`,
- `addRoutine`,
- `deleteRoutine`,
- l'association des reflexions aux habitudes liees a une dimension.

Le scope est strictement visuel et structurel, avec eventuellement de petits libelles de resume si necessaire.

## Tests et validation

### Tests UI attendus

- rendu du resume de dimension,
- presence lisible des etats `actif` / `repos`,
- maintien des routines sous le bon principe,
- maintien des reflexions en section secondaire,
- absence de regression sur les actions existantes.

### Validation visuelle attendue

- lecture plus rapide de l'ecran,
- meilleure separation entre primaire et secondaire,
- aucun bruit decoratif,
- conformite avec `DESIGN.md` et `DESIGN_SYSTEM.md`,
- passage `npx -y impeccable detect src/` avant validation finale.

## Critere de succes

La refonte est reussie si, a l'ouverture de `Principles`, un utilisateur peut identifier sans effort :

- la dimension en cours,
- les principes actuellement actifs,
- l'action possible du moment,
- les routines et reflexions comme contenus de second niveau.
