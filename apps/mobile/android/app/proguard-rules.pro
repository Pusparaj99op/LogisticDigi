# R8 rules for the release build.
#
# The Flutter Gradle plugin already contributes the engine's own rules, and
# the Firebase SDKs ship theirs as consumer rules inside their AARs, so this
# file only needs what R8 cannot infer on its own.

# Firebase/Firestore models are deserialised reflectively from documents, so
# the field names must survive obfuscation or every read comes back null.
-keepclassmembers class * {
    @com.google.firebase.firestore.PropertyName <fields>;
    @com.google.firebase.firestore.PropertyName <methods>;
}

# Google Sign-In resolves these by name through Play Services.
-keep class com.google.android.gms.auth.** { *; }
-keep class com.google.android.gms.common.** { *; }

# R8 warns about optional Play Core split-install classes that Flutter
# references but this app (a single non-split APK) never loads.
-dontwarn com.google.android.play.core.**
