# LogisticDigi — mobile (Phase 6)

Flutter companion to `apps/web`: the same operations console (Floor,
Approvals, Ledger) against the same Firestore project, for an operator who
needs to approve a payment away from a desk. It reads and writes exactly the
collections `firebase/firestore.rules` allows a client to touch — approvals
only, and only the four fields the rules accept while a request is pending.

## One-time setup

```bash
cd apps/mobile
flutter pub get

# Requires the Firebase CLI (`npm i -g firebase-tools`, `firebase login`)
dart pub global activate flutterfire_cli
flutterfire configure --project=logisticdigi
```

`flutterfire configure` registers Android/iOS apps against the `logisticdigi`
Firebase project and overwrites `lib/firebase_options.dart` (currently a
stub — see the comment at the top of that file). Until that command has run,
the app boots to a "Firebase is not configured" screen instead of crashing,
mirroring how `apps/web` handles a missing `.env.local`.

## Run

```bash
flutter run
```

## Structure

- `lib/theme.dart` — the hazard/floor/paper palette, ported from
  `apps/web/src/app/globals.css`.
- `lib/models.dart`, `lib/live.dart` — Firestore document shapes and streams,
  ported from `apps/web/src/components/live.ts`. Money stays a string of
  minor units end to end, same as `packages/core/src/money.ts` — never a
  float.
- `lib/session.dart` — auth + custom-claim state, ported from
  `apps/web/src/lib/auth-context.tsx`.
- `lib/screens/` — Sign in, Floor, Approvals, Ledger, ported from
  `apps/web/src/app/sign-in` and `apps/web/src/app/operations/*`.

The map (`apps/web/src/app/operations/map`) and admin panel
(`apps/web/src/app/operations/admin`) are deliberately not ported: a 3D globe
and platform-owner kill switches are console tools, not something an operator
needs from a phone. Add them here if that assumption turns out wrong.
