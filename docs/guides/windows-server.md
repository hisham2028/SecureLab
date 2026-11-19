# Running the SecureLab server on a Windows PC

Use this guide when the only machine you have for the server is a Windows PC. Staff and
students won't notice any difference: they use the dashboard in a browser and the SecureLab app
on the lab PCs, exactly as in the [deployment guide](../../deploy/README.md).

**Why a virtual machine?** Judge0, the part that runs students' code, needs a Linux sandbox that
uses a Linux kernel feature called cgroup v1. Windows doesn't have it. Docker Desktop's built-in
Linux (WSL2) doesn't either, and it can't be switched on there
([Judge0 issue #583](https://github.com/judge0/judge0/issues/583)). So the PC runs Ubuntu in a
virtual machine (VM), and SecureLab and Judge0 run together inside it. You set the VM up once.
After that, everything is copy and paste.

**Using Hyper-V on Windows 11 Pro or Education?** The [one-PC Hyper-V guide](one-pc-hyper-v.md)
walks through the same setup with exact PowerShell commands, VM sizes, a fixed address and AI help.

## What you need

|                 | Up to about 60 students         | With AI help too                  |
| --------------- | ------------------------------- | --------------------------------- |
| PC memory       | 16 GB                           | 32 GB                             |
| CPU             | 4 cores or more (8 is better)   | 8 cores or more                   |
| Free disk       | 100 GB                          | 120 GB                            |
| Given to the VM | 4 CPUs, 8 GB memory, 80 GB disk | 6 CPUs, 20 GB memory, 100 GB disk |

You also need:

- Windows 10 or 11. Pro, Education or Enterprise can use Hyper-V, which is built in. Home needs
  VirtualBox, which is free.
- A **wired** connection to the university network that the lab PCs are on.
- Ideally, a fixed address for the server from university IT: a DHCP reservation and, better
  still, a name such as `exam.cse.example.edu`. Lab PCs connect to that address, so it must not
  change between exams.

## 1. Check that virtualization is on

Open Task Manager → Performance → CPU. **Virtualization: Enabled** must show. If it says
Disabled, turn on "Intel VT-x" or "AMD-V/SVM" in the PC's BIOS settings.

## 2. Create the VM

Download **Ubuntu Server 24.04 LTS** from <https://ubuntu.com/download/server>. Use 24.04,
not a newer release: newer Ubuntu versions have removed the cgroup v1 setting that Judge0 needs.

### With Hyper-V (Windows Pro, Education, Enterprise)

1. Start → "Turn Windows features on or off" → tick **Hyper-V** → OK, then restart.
2. Open **Hyper-V Manager** → **Virtual Switch Manager** → **New virtual network switch** →
   **External**. Pick the PC's wired network card, name it `Lab network`, and press OK.
3. **New → Virtual Machine**:
   - Name: `SecureLab`
   - **Generation 2**
   - Memory: 8192 MB, with **Use Dynamic Memory** unticked
   - Network: `Lab network`
   - Disk: 80 GB
   - Install from the Ubuntu ISO file
4. Before starting it, open the VM's **Settings**:
   - **Security**: set Template to **Microsoft UEFI Certificate Authority**, or Ubuntu won't boot.
   - **Processor**: 4 virtual processors.
   - **Automatic Start Action**: Always start this virtual machine automatically.
   - **Automatic Stop Action**: Shut down the guest operating system.
5. **Connect** and **Start**.

### With VirtualBox (Windows Home)

1. Install VirtualBox 7 from <https://www.virtualbox.org>.
2. **New**:
   - Name: `SecureLab`
   - ISO image: the Ubuntu ISO
   - Tick **Skip unattended installation**
   - Memory: 8192 MB, 4 CPUs
   - Disk: 80 GB
3. **Settings → Network → Adapter 1**: Attached to **Bridged Adapter**, Name: the wired network
   card.
4. **Start**.

If Hyper-V, WSL or Docker Desktop is also on this PC, VirtualBox still works, but more slowly.
A small turtle icon in the VM window's status bar means it is in that slower mode.

## 3. Install Ubuntu

Mostly press Enter to accept the defaults. These steps matter:

- **Type of installation**: Ubuntu Server (not minimized).
- **Network**: it should show an address from the university network, such as `10.20.30.40`.
  Write it down. If IT gave you a fixed address, choose the network card → **Edit IPv4** →
  **Manual**, and enter it there.
- **Storage**: use the entire disk.
- **Profile**: your name, server name `securelab`, a username and a strong password.
- **SSH**: tick **Install OpenSSH server**.
- **Featured snaps**: skip.

When it finishes, choose **Reboot now**, then press Enter if it asks you to remove the
installation medium.

## 4. Connect from Windows

Typing in the VM window is awkward, so connect from Windows Terminal or PowerShell instead.
Copy and paste then work.

```powershell
ssh yourname@10.20.30.40
```

Use your Ubuntu username and the VM's address. If you've lost the address, sign in on the VM
window and type `ip -4 addr`.

## 5. Install SecureLab

On the VM, through ssh:

```sh
sudo apt update && sudo apt -y upgrade
git clone https://github.com/hisham2028/SecureLab.git securelab
cd securelab
./deploy/one-machine.sh
```

If IT gave you a name for the server, add it to the last command:
`./deploy/one-machine.sh exam.cse.example.edu`. Otherwise the server uses the VM's IP address.

The first run switches Ubuntu to cgroup v1 and asks you to restart:

```sh
sudo reboot
```

Wait a minute, connect with `ssh` again, and run the script a second time:

```sh
cd securelab && ./deploy/one-machine.sh
```

This time it does the rest, which takes 10 to 20 minutes:

- installs Docker
- writes the settings with new random passwords
- starts Judge0 and SecureLab
- checks that Judge0 really runs a test program
- asks for the first admin's email and password

It ends by printing the dashboard address and the line for the student app's `config.json`.
You can run it again at any time. It keeps your settings and only starts what isn't running.

## 6. Trust the certificate and sign in

The server makes its own HTTPS certificate. Each computer that connects must trust it once. Copy
it to Windows, in PowerShell on your PC:

```powershell
scp yourname@10.20.30.40:securelab-root.crt .
```

Then, in PowerShell **as administrator**:

```powershell
Import-Certificate -FilePath .\securelab-root.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Open `https://10.20.30.40/` (or your server's name) in a browser and sign in with the admin you
just created. Under **Staff**, add the teachers and invigilators.

## 7. Set up the lab PCs

Follow the [lab PC installation guide](lab-pc-install.md). Each lab PC needs the SecureLab app,
the same certificate, and this `config.json`, using the address the script printed:

```json
{ "apiUrl": "https://10.20.30.40/api" }
```

Then run a full practice exam with a few colleagues, and the
[rehearsal plan](rehearsal-plan.md) before any graded exam.

## Keeping it running

**On exam days, the PC must stay on.**

- Plug it in, keep it wired, and set Settings → System → Power → Sleep to **Never**.
- In Windows Update, **Pause updates** for the exam week, so Windows doesn't restart in the
  middle of an exam.

**Starting with Windows.**

- Hyper-V does this already (step 2).
- With VirtualBox, open Task Scheduler and create a task that runs "When the computer starts",
  with "Run whether user is logged on or not". Its action is
  `"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe"` with the arguments
  `startvm "SecureLab" --type headless`.
- SecureLab starts by itself when the VM starts.

**Before restarting Windows,** shut the VM down first with `sudo poweroff`. Hyper-V does this
for you. A VM that is switched off mid-write can damage the database.

**Useful commands on the VM.** The script adds a short command, `securelab`:

```sh
securelab ps                 # what is running
securelab logs -f api worker # what the server is doing
```

**Backups.** The server takes one every night into `~/securelab/deploy/backups` on the VM. Copy
them off the PC regularly, and before and after each exam, from PowerShell:

```powershell
scp -r yourname@10.20.30.40:securelab/deploy/backups D:\SecureLab-backups
```

Restoring is in the [backup and restore runbook](../ops/backup-restore.md).

**Updating SecureLab.** Never during an exam. Take a backup, then on the VM:

```sh
cd ~/securelab && git pull && ./deploy/one-machine.sh
```

## Limits of this setup

- **One PC.** If it fails during an exam, the exam stops until it is back. Keep the paper
  fallback from the [incident runbook](../ops/incident-response.md) ready.
- **Judge0 shares the machine with the database.** Student code still runs in Judge0's sandbox
  with no network access, but the [deployment guide](../../deploy/README.md) puts Judge0 on its
  own machine for stronger separation. That setup is fine for a pilot. For regular graded exams,
  ask university IT for a Linux server, or two.
- **Check that it keeps up.** Run the load test from section 8 of the deployment guide from a lab
  PC, with as many students as your biggest class.
