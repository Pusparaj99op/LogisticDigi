/// LogisticDigi design tokens, ported from apps/web/src/app/globals.css.
///
/// Two surfaces: floor (near-black, live agent activity) and paper (warm
/// off-white, money and evidence). Hazard yellow marks the one boundary that
/// matters: where autonomy stops and a human decision begins.
library;

import 'package:flutter/material.dart';

class AppColors {
  AppColors._();

  static const void_ = Color(0xFF0B0B0C);
  static const steel = Color(0xFF17181B);
  static const steelRaised = Color(0xFF1F2126);
  static const seam = Color(0xFF2B2E34);

  static const hazard = Color(0xFFFFC400);
  static const hazardDeep = Color(0xFFC99700);
  static const hazardWash = Color(0x1AFFC400);

  static const paper = Color(0xFFF7F5EF);
  static const paperShade = Color(0xFFE9E5DA);
  static const ink = Color(0xFF101114);
  static const inkSoft = Color(0xFF55565C);

  static const chalk = Color(0xFFF2F2F0);
  static const chalkSoft = Color(0xFF9A9CA3);
  static const chalkFaint = Color(0xFF64666D);

  static const refused = Color(0xFFE5484D);
  static const clear = Color(0xFF4FB286);
}

enum Tone { neutral, hazard, refused, clear }

Color toneColor(Tone tone) {
  switch (tone) {
    case Tone.neutral:
      return AppColors.chalkSoft;
    case Tone.hazard:
      return AppColors.hazard;
    case Tone.refused:
      return AppColors.refused;
    case Tone.clear:
      return AppColors.clear;
  }
}

ThemeData buildAppTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: AppColors.void_,
    colorScheme: base.colorScheme.copyWith(
      primary: AppColors.hazard,
      onPrimary: AppColors.void_,
      surface: AppColors.steel,
      onSurface: AppColors.chalk,
      error: AppColors.refused,
    ),
    textTheme: base.textTheme.apply(
      bodyColor: AppColors.chalk,
      displayColor: AppColors.chalk,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.void_,
      foregroundColor: AppColors.chalk,
      elevation: 0,
    ),
    cardTheme: const CardThemeData(
      color: AppColors.steel,
      elevation: 0,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: AppColors.seam),
        borderRadius: BorderRadius.all(Radius.circular(2)),
      ),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.seam),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.hazard,
        foregroundColor: AppColors.void_,
        disabledBackgroundColor: AppColors.hazard.withValues(alpha: 0.5),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(2)),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.chalk,
        side: const BorderSide(color: AppColors.seam),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(2)),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.void_,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(2),
        borderSide: const BorderSide(color: AppColors.seam),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(2),
        borderSide: const BorderSide(color: AppColors.seam),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(2),
        borderSide: const BorderSide(color: AppColors.hazard),
      ),
    ),
  );
}

/// Eyebrow label style: small, spaced, mono-ish, uppercase. Names a region,
/// never decorates.
TextStyle eyebrowStyle({bool onPaper = false}) => TextStyle(
      fontFamily: 'monospace',
      fontSize: 11,
      letterSpacing: 1.6,
      color: onPaper ? AppColors.inkSoft : AppColors.chalkFaint,
    );

/// Monospace figure style for money, txids, ids — aligns in columns.
TextStyle tabularStyle({Color? color, double fontSize = 14}) => TextStyle(
      fontFamily: 'monospace',
      fontSize: fontSize,
      color: color ?? AppColors.chalk,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
