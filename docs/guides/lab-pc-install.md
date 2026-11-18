# Installing SecureLab on lab PCs

For lab IT. Do this once per PC (or once in your image), then again for each new version.
The server side is in the [deployment guide](../../deploy/README.md).

## What you need

- Windows 10 or 11, 64-bit, 4 GB RAM, a screen of at least 1024×640.
- `SecureLab Setup <version>.exe`, from the release or the CI build artifact
  `securelab-student-windows`, and its SHA-256 from the person who built it.
- The exam server's address, such as `https://exam.cse.example.edu/api`.
- If the server uses `SECURELAB_TLS=internal`: the `securelab-root.crt` file from the server
  admin.

## 1. Check the installer

The installer isn't code-signed yet (security review S11), so Windows SmartScreen will warn.
Check the file before you trust it:

```powershell
Get-FileHash ".\SecureLab Setup 0.1.0.exe" -Algorithm SHA256
```

The hash must match the published value exactly. If it doesn't, don't install it.

## 2. Install for all users

Run the installer as an administrator. It installs for every user into
`C:\Program Files\SecureLab\`, where students can't change anything. For deployment tools,
`/S` installs silently:

```powershell
& ".\SecureLab Setup 0.1.0.exe" /S
```

## 3. Point it at the exam server

Create `C:\Program Files\SecureLab\config.json`:

```json
{ "apiUrl": "https://exam.cse.example.edu/api" }
```

The installed app reads only this file. It ignores per-user settings and environment
variables, so a student can't point it at another server. Copy the same file to every PC, for
example with Group Policy Preferences.

## 4. Trust the server's certificate (only for `internal`)

If the server uses an institution certificate or Let's Encrypt, skip this. Otherwise install
`securelab-root.crt` into **Local Computer → Trusted Root Certification Authorities**:

```powershell
Import-Certificate -FilePath .\securelab-root.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Or push it with Group Policy (Computer Configuration → Policies → Windows Settings → Security
Settings → Public Key Policies → Trusted Root Certification Authorities). SecureLab uses the
Windows certificate store, so nothing else is needed.

## 5. Network

Lab PCs need HTTPS (port 443) to the exam server, and nothing else. They never talk to the Judge0
host. If your lab uses a proxy, SecureLab follows the Windows proxy settings.

## 6. Check each PC

Open SecureLab. The sign-in screen should appear. Sign in with a test seat from a practice exam
(ask a host for one). The **system check** before the exam should show a tick on every row:

- **Exam server**: reachable (a cross here blocks the start)
- **Saving work on this computer**: the app can save drafts (a cross here blocks the start)
- **Encrypted local copies**: Windows can encrypt the saved drafts
- **Secure connection**: the address in `config.json` starts with `https://`
- **Computer clock**: within 2 minutes of the server. It doesn't affect exam timing, but helps
  when reading logs.
- **Screen size**: at least 1024×640

Write down any PC that fails and fix it before the exam, or mark it as out of use.

## Optional: lock down the PC

SecureLab opens full screen, but that isn't lockdown: a student can still switch apps. If the
institution wants other apps blocked during exams, use Windows kiosk mode, AppLocker or your
device management tool for the exam user account. Whatever you choose, test it in the
[rehearsal](rehearsal-plan.md).

## Updating

Install the new version over the old one the same way, then check that `config.json` is still in
`C:\Program Files\SecureLab\` and copy it again if the update removed it. The certificate stays.
Never update during an exam week without re-running the checks above on a few PCs.
