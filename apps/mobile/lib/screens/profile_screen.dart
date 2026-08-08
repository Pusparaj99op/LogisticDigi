/// Account and profile: sign-out, avatar, and workspace info — the only
/// user-related surface in the app before this, a bare AppBar icon, now has
/// a real home.
library;

import 'dart:io';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/primitives.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _uploading = false;
  String? _uploadError;

  Future<void> _changePhoto(Session session) async {
    final user = session.user;
    if (user == null) return;

    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1024, imageQuality: 85);
    if (picked == null) return;

    setState(() {
      _uploading = true;
      _uploadError = null;
    });
    try {
      final ref = FirebaseStorage.instance.ref('avatars/${user.uid}');
      await ref.putFile(
        File(picked.path),
        SettableMetadata(contentType: 'image/jpeg'),
      );
      final url = await ref.getDownloadURL();
      await user.updatePhotoURL(url);
      await session.refreshUser();
    } catch (cause) {
      setState(() => _uploadError = 'Could not upload: $cause');
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<Session>();
    final user = session.user;
    final name = user?.displayName ?? user?.email ?? 'Signed in';
    final initials = _initialsOf(name);

    return Scaffold(
      backgroundColor: AppColors.void_,
      appBar: AppBar(
        title: const Text('Profile', style: TextStyle(fontSize: 16, letterSpacing: 1.2)),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: GestureDetector(
              onTap: _uploading ? null : () => _changePhoto(session),
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  CircleAvatar(
                    radius: 44,
                    backgroundColor: AppColors.hazardWash,
                    backgroundImage: user?.photoURL != null ? NetworkImage(user!.photoURL!) : null,
                    child: user?.photoURL == null
                        ? Text(initials, style: const TextStyle(color: AppColors.hazard, fontSize: 28, fontWeight: FontWeight.w700))
                        : null,
                  ),
                  if (_uploading)
                    const Positioned.fill(
                      child: CircleAvatar(
                        radius: 44,
                        backgroundColor: Colors.black45,
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.hazard),
                        ),
                      ),
                    ),
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: const BoxDecoration(color: AppColors.hazard, shape: BoxShape.circle),
                      child: const Icon(Icons.edit, size: 14, color: Color(0xFF1A1512)),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_uploadError != null) ...[
            const SizedBox(height: 8),
            Center(child: Text(_uploadError!, style: const TextStyle(color: AppColors.refused, fontSize: 12))),
          ],
          const SizedBox(height: 8),
          Center(
            child: Text(name, style: const TextStyle(color: AppColors.chalk, fontSize: 18)),
          ),
          if (user?.email != null)
            Center(
              child: Text(user!.email!, style: const TextStyle(color: AppColors.chalkFaint, fontSize: 13)),
            ),
          const SizedBox(height: 24),

          FloorPanel(
            title: 'Workspace',
            child: Column(
              children: [
                _InfoRow(label: 'Tenant', value: session.tenantId ?? 'no workspace yet'),
                _InfoRow(label: 'Role', value: session.role ?? 'member'),
                if (session.platformOwner) _InfoRow(label: 'Access', value: 'Platform controls'),
              ],
            ),
          ),
          const SizedBox(height: 16),

          FloorPanel(
            title: 'Subscription',
            child: const Padding(
              padding: EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Free — demo workspace', style: TextStyle(color: AppColors.chalk, fontSize: 14)),
                  SizedBox(height: 6),
                  Text(
                    'No billing is connected to this project — there is nothing to upgrade yet. '
                    'This is informational only.',
                    style: TextStyle(color: AppColors.chalkFaint, fontSize: 12),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => session.leave(),
              icon: const Icon(Icons.logout, size: 18, color: AppColors.refused),
              label: const Text('Sign out', style: TextStyle(color: AppColors.refused)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.refused),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.chalkFaint, fontSize: 13)),
          Text(value, style: const TextStyle(color: AppColors.chalk, fontSize: 13)),
        ],
      ),
    );
  }
}

String _initialsOf(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
  return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
}
