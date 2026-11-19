# SecureLab on one Windows PC with Hyper-V

This guide runs **all of SecureLab on one Windows 11 PC**: the server, Judge0 (which runs the
students' code) and, if you want it, free AI help (Ollama). Lab PCs connect to this PC over the
network. It is a step-by-step version of the [Windows server guide](windows-server.md) for
Hyper-V, with exact numbers.

It was written for this PC. If yours is different, see [Other PCs](#other-pcs) at the end.

| PC         | HP Pro Tower 290 G9                                  |
| ---------- | ---------------------------------------------------- |
| Windows    | Windows 11 Education                                 |
| CPU        | Intel i7-14700 (20 cores, 28 threads)                |
| Memory     | 32 GB                                                |
| Already on | Virtualization-based security (so a hypervisor runs) |

**Why Hyper-V and not VirtualBox?** Windows security features (VBS, Credential Guard, HVCI)
already run the Windows hypervisor. VirtualBox then runs in a slow mode. Hyper-V is built in and
works with them, so use Hyper-V.

**Why a virtual machine (VM) at all?** Judge0 needs a Linux feature called cgroup v1. Windows and
Docker Desktop (WSL2) don't have it. Ubuntu 24.04 inside a Hyper-V VM does. Hyper-V doesn't change
this: the VM runs a normal Ubuntu kernel, and the setup script turns cgroup v1 on.

## The plan

```
 Windows PC (32 GB, 28 threads)
 ├── Windows itself: 12 GB, 16 threads left over
 └── Hyper-V VM "SecureLab": Ubuntu Server 24.04, 12 CPUs, 20 GB, 100 GB disk
      ├── SecureLab (dashboard, API, database, HTTPS)
      ├── Judge0 (runs student code, not reachable from the network)
      └── Ollama (optional AI help)

 Lab PCs ──── university network ──── VM's own address, for example 10.20.30.40
```

The VM gets **its own address** on the university network through an **External switch**. Lab
PCs talk to that address directly. Windows Firewall on the host is not in the way.

You need:

- About **2 hours** the first time.
- The PC **wired** to the same network as the lab PCs. Wi-Fi does not work well with Hyper-V.
- **An administrator password** for this PC, or someone from lab IT, for step 1 only.
- **A fixed address for the VM** from university IT (step 4). Ask early.
- **150 GB free** on drive C:.

---

## Step 1. Turn on Hyper-V (needs an administrator)

You are signed in as **Student**, which is not an administrator. That is why you saw
"requires elevation". Do this:

1. Click **Start**, type `PowerShell`.
2. Right-click **Windows PowerShell** → **Run as administrator**.
3. If Windows asks for a username and password, type the administrator's. If you don't have one,
   ask lab IT to do steps 1 and 2 with you.
4. In the blue window that says **Administrator** in its title, paste:

   ```powershell
   Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
   ```

5. When it asks to restart, type `Y`. The PC restarts, maybe twice.

**So you can manage the VM later without the admin password**, ask the admin to also add your
account to the Hyper-V Administrators group. First find your exact account name in a normal
PowerShell (not admin):

```powershell
whoami
```

It prints something like `hp-lab\student`. Then in **admin** PowerShell, using that name:

```powershell
Add-LocalGroupMember -Group "Hyper-V Administrators" -Member "hp-lab\student"
```

Sign out and back in once. Now Hyper-V Manager works from your Student account.

> If Windows says the feature is blocked by your organization, lab IT controls this PC by
> policy. Show them this guide. They need to allow the Hyper-V feature on this one PC.

**Check:** Start → type `Hyper-V Manager`. It should open and show your PC's name on the left.

## Step 2. Create the network switch and the VM

Download **Ubuntu Server 24.04 LTS** (the `live-server-amd64.iso` file, about 3 GB) from
<https://ubuntu.com/download/server> into your **Downloads** folder.

Use **24.04**. Do not use 25.04, 25.10 or 26.04: they removed the cgroup v1 setting that Judge0
needs. Do not use Hyper-V "Quick Create" either: it installs Ubuntu Desktop, not Server.

### 2a. Find the wired network card's name

In PowerShell (as administrator, or as Student if you did the group step):

```powershell
Get-NetAdapter -Physical | Format-Table Name, InterfaceDescription, Status
```

Find the wired card with Status **Up**. It is usually called `Ethernet`. Use that name below.

### 2b. Create the External switch

This connects the VM straight to the university network. The PC loses its network for a few
seconds while it is created. That is normal.

```powershell
New-VMSwitch -Name "Lab network" -NetAdapterName "Ethernet" -AllowManagementOS $true
```

(`-AllowManagementOS $true` keeps Windows itself online through the same card.)

### 2c. Create the VM

Paste this whole block. It makes a VM with **12 CPUs, 20 GB memory (fixed), 100 GB disk**:

```powershell
$iso = (Get-ChildItem "$env:USERPROFILE\Downloads\ubuntu-24.04*-live-server-amd64.iso" | Select-Object -First 1).FullName
New-Item -ItemType Directory -Force C:\Hyper-V | Out-Null

New-VM -Name SecureLab -Generation 2 -MemoryStartupBytes 20GB `
  -NewVHDPath C:\Hyper-V\SecureLab.vhdx -NewVHDSizeBytes 100GB -SwitchName "Lab network"

Set-VM -Name SecureLab -ProcessorCount 12 -StaticMemory -CheckpointType Disabled `
  -AutomaticStartAction Start -AutomaticStartDelay 0 -AutomaticStopAction ShutDown

# Ubuntu needs this Secure Boot template, or it won't start.
Set-VMFirmware -VMName SecureLab -SecureBootTemplate MicrosoftUEFICertificateAuthority

# A fixed network card address (MAC), so IT can give the VM a fixed IP.
Set-VMNetworkAdapter -VMName SecureLab -StaticMacAddress ("00155D" + (Get-Random -Maximum 0xFFFFFF).ToString("X6"))

Add-VMDvdDrive -VMName SecureLab -Path $iso
Set-VMFirmware -VMName SecureLab -FirstBootDevice (Get-VMDvdDrive -VMName SecureLab)

Get-VMNetworkAdapter -VMName SecureLab | Format-Table VMName, MacAddress
```

If the first line gives an error, the ISO is not in Downloads. Fix the path and run the block
again (first remove the half-made VM with `Remove-VM SecureLab -Force`).

What these settings do:

| Setting                | Why                                                                 |
| ---------------------- | ------------------------------------------------------------------- |
| 12 CPUs                | Judge0, the database and AI share them. Windows keeps 16 threads.   |
| 20 GB, static memory   | Enough for all parts with AI. Dynamic memory can starve Judge0.     |
| Checkpoints disabled   | Old checkpoints silently fill the disk.                             |
| Automatic start action | The VM starts when Windows starts, even if no one signs in.         |
| Automatic stop action  | Windows shuts Ubuntu down cleanly before it restarts.               |
| Static MAC             | The VM's network identity never changes, so its IP can be reserved. |

**Write down the MAC address** the last line prints (like `00155D4A1B2C`). IT needs it in step 4.

Without AI help, you can give the VM less: `-MemoryStartupBytes 12GB` and `-ProcessorCount 8`.

## Step 3. Install Ubuntu

Start the VM and open its window:

```powershell
Start-VM SecureLab
vmconnect localhost SecureLab
```

Choose **Try or Install Ubuntu Server**. Then mostly press **Enter** to accept. Only these
screens matter:

| Screen                | Choose                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| Type of installation  | **Ubuntu Server** (not minimized)                                       |
| Network connections   | `eth0` should show an address like `10.20.30.40`. See step 4 for fixed. |
| Proxy, mirror         | Leave as is, unless IT says the network needs a proxy                   |
| Storage               | **Use an entire disk**                                                  |
| Storage summary       | Done → **Continue**                                                     |
| Profile               | Your name, server name `securelab`, username `admin1`, strong password  |
| Ubuntu Pro            | Skip for now                                                            |
| SSH                   | Tick **Install OpenSSH server**                                         |
| Featured server snaps | Tick nothing                                                            |

The examples below use username `admin1`. If you chose another, use yours.

When it says **Install complete**, choose **Reboot now**. If it says "remove the installation
medium", just press **Enter**.

**If the network screen shows no address**, the university network may block a second device on
the same wall socket. Ask IT to allow it, or see [If the network blocks the VM](#if-the-network-blocks-the-vm).

## Step 4. Give the VM a fixed address

Lab PCs use this address in every exam, so it must never change. Pick **one** way:

**A. Best: DHCP reservation by IT.** Send IT the MAC address from step 2c and ask for a
reserved IP (and, if possible, a name like `exam.cse.example.edu`). Nothing to change in
Ubuntu. After IT does it, restart the VM (`sudo reboot`) and check the address (below).

**B. Static IP set in Ubuntu.** IT gives you an IP, the network mask (like `/24`), the gateway
and DNS servers. Sign in on the VM window and run (change the four values to IT's):

```sh
sudo tee /etc/netplan/50-cloud-init.yaml >/dev/null <<'EOF'
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: false
      addresses: [10.20.30.40/24]
      routes:
        - to: default
          via: 10.20.30.1
      nameservers:
        addresses: [10.20.0.53, 10.20.0.54]
EOF
sudo chmod 600 /etc/netplan/50-cloud-init.yaml
echo 'network: {config: disabled}' | sudo tee /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
sudo netplan apply
```

**Check** on the VM window:

```sh
ip -4 addr show eth0     # shows your fixed address
ping -c 3 ubuntu.com     # the internet works
```

The rest of this guide writes **`10.20.30.40`**. Use your VM's real address everywhere you see it.

## Step 5. Connect from Windows with ssh

Typing in the VM window is awkward. Use Windows instead, so copy and paste work. Open
**Windows Terminal** or **PowerShell** (normal, not admin):

```powershell
ssh admin1@10.20.30.40
```

Type `yes` the first time, then your Ubuntu password. You are now "on the VM". Every `sh` block
below runs here.

## Step 6. Install SecureLab and Judge0

On the VM:

```sh
sudo apt update && sudo apt -y upgrade
git clone https://github.com/hisham2028/SecureLab.git securelab
cd securelab
./deploy/one-machine.sh
```

If IT gave you a name, add it: `./deploy/one-machine.sh exam.cse.example.edu`. Otherwise the
script uses the VM's IP address. Choose now: lab PCs will use this address forever.

**The first run turns on cgroup v1 for Judge0 and stops.** Restart the VM:

```sh
sudo reboot
```

Wait one minute. Connect again and run the script a second time:

```powershell
ssh admin1@10.20.30.40
```

```sh
cd securelab && ./deploy/one-machine.sh
```

This run takes 10 to 20 minutes. It:

1. checks cgroup v1 is on (`OK`)
2. installs Docker
3. writes `deploy/.env` and `deploy/judge0/judge0.env` with new random passwords
4. starts Judge0, then SecureLab
5. **runs a test Python program in Judge0** and expects `42`
6. asks for the **first admin** (see step 7)
7. saves the HTTPS root certificate to `~/securelab-root.crt`

### What the script sets for you

You don't need to edit these. They are here so you know:

| Setting in `deploy/.env` | Value                     | Why                                                                                                                                                                                               |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECURELAB_DOMAIN`       | `10.20.30.40` or the name | The address lab PCs use                                                                                                                                                                           |
| `SECURELAB_TLS`          | `internal`                | SecureLab makes its own HTTPS certificate (step 8)                                                                                                                                                |
| `JUDGE0_URL`             | `http://judge0:2358`      | Judge0 on the **same machine**, over a private Docker network. Not `localhost`: inside the API's container, `localhost` is the container itself. Judge0's port is not open to the network at all. |
| `JUDGE0_AUTH_TOKEN`      | random                    | Same as `AUTHN_TOKEN` in `judge0.env`                                                                                                                                                             |

**If it stops with "the machine started with the cgroup v1 setting but still uses cgroup v2"**,
you installed a newer Ubuntu than 24.04. Reinstall with 24.04.

## Step 7. Create the first admin

At the end, the script asks:

```
Admin email (leave empty to skip): you@your-university.edu
Password (12 or more characters):
```

Type your email and a long password. The password doesn't show while you type. That's normal.

Missed it? Run the script again (`cd ~/securelab && ./deploy/one-machine.sh`). It keeps all
settings and asks again.

At the end the script prints something like:

```
Dashboard:             https://10.20.30.40/
Student app config:    { "apiUrl": "https://10.20.30.40/api" }
Root certificate for lab PCs and staff computers: /home/admin1/securelab-root.crt
```

Copy these lines into a text file. Then **sign out and back in once** (`exit`, then `ssh` again)
so the short `securelab` command works.

## Step 8. Trust the HTTPS certificate on this PC

SecureLab made its own certificate (`internal`). Each computer that connects must trust it once.

In **normal** PowerShell on Windows, copy it from the VM:

```powershell
cd $env:USERPROFILE\Downloads
scp admin1@10.20.30.40:securelab-root.crt .
```

Then in **admin** PowerShell (needs the admin password again):

```powershell
Import-Certificate -FilePath "$env:USERPROFILE\Downloads\securelab-root.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

(If the admin is a different account, `$env:USERPROFILE` points to the admin's folder. Then copy
the file to `C:\Users\Public\` first and use that path.)

Close and reopen your browser. Open **`https://10.20.30.40/`**. There must be no warning. Sign in
with the admin from step 7. Under **Staff**, add teachers and invigilators.

Keep `securelab-root.crt` safe. Every lab PC needs this same file.

## Step 9. Set up the lab PCs

On **each lab PC** (lab IT usually does this; full details are in the
[lab PC installation guide](lab-pc-install.md)):

1. Install the SecureLab student app.
2. Install `securelab-root.crt` into **Trusted Root Certification Authorities** (the same
   `Import-Certificate` command as step 8, or by group policy for many PCs).
3. Create `C:\Program Files\SecureLab\config.json` with exactly this (your address):

   ```json
   { "apiUrl": "https://10.20.30.40/api" }
   ```

   Quick way, in admin PowerShell on the lab PC:

   ```powershell
   Set-Content -Path "C:\Program Files\SecureLab\config.json" -Value '{ "apiUrl": "https://10.20.30.40/api" }' -Encoding ascii
   ```

4. Check from the lab PC:

   ```powershell
   curl.exe https://10.20.30.40/api/health/ready
   ```

   It must print `{"status":"ok","db":"ok"}`. If it says a certificate error, step 2 is missing.
   If it times out, the lab PC can't reach the VM: ask IT whether the lab network can reach it.

You can also run the student app on this same Windows PC for a quick test. It already trusts
the certificate after step 8.

## Step 10. AI help (optional)

This runs a free coding model on the VM. Student code never leaves the PC. Skip this step if you
don't want AI help.

On the VM:

```sh
cd ~/securelab
sed -i 's|^AI_BASE_URL=.*|AI_BASE_URL=http://ollama:11434/v1|' deploy/.env
sed -i 's|^AI_MODEL=.*|AI_MODEL=qwen2.5-coder:7b|' deploy/.env
securelab --profile ai up -d
securelab exec ollama ollama pull qwen2.5-coder:7b
```

The last line downloads about 5 GB once. Then check:

```sh
securelab exec ollama ollama list      # shows qwen2.5-coder:7b
```

In the dashboard, open a question's **AI help** setting. It should no longer say "isn't set up".
Make a practice exam with AI help on and ask a question from the student app.

Good to know:

- There is no graphics card in the VM, so the model runs on the CPU. An answer takes about 10 to
  40 seconds. Up to 4 students are answered at once; others are asked to wait.
- From now on, add `--profile ai` whenever you start things by hand: `securelab --profile ai up -d`.
  Ollama restarts by itself after a reboot.
- After updating SecureLab with the script (see below), also run `securelab --profile ai up -d`.

## Step 11. Final check

Do all of these before the first real exam.

**On the VM** (`ssh admin1@10.20.30.40`):

```sh
stat -fc %T /sys/fs/cgroup                 # must print: tmpfs   (cgroup v1 for Judge0)
securelab ps                               # postgres, api, worker, web, backup, retention: running
docker ps --format '{{.Names}}' | grep -i judge0   # Judge0 server and workers are listed
cd ~/securelab && ./deploy/one-machine.sh  # re-runs every check, including the "42" test
```

The last command should end with `OK: Judge0 ran a test program and got 42` and `Done`. Press
Enter to skip the admin question.

**On Windows (this PC):**

```powershell
Test-NetConnection 10.20.30.40 -Port 443   # TcpTestSucceeded : True
curl.exe https://10.20.30.40/api/health/ready
```

**Restart test:** restart Windows. Don't sign in. From another computer, open
`https://10.20.30.40/` after 3 to 5 minutes. It must load. This proves the VM starts by itself.

**Exam test:** with 2 or 3 colleagues on lab PCs, run a short practice exam: sign in, write code,
**Run** it, submit, and check the results in the dashboard. With AI help, ask one question too.
Then follow the [rehearsal plan](rehearsal-plan.md) before any graded exam.

| Check                            | Done |
| -------------------------------- | ---- |
| cgroup shows `tmpfs`             | ☐    |
| Script ends with "got 42"        | ☐    |
| Dashboard opens with no warning  | ☐    |
| Lab PC `health/ready` says ok    | ☐    |
| VM starts after Windows restarts | ☐    |
| Practice exam graded correctly   | ☐    |
| AI answers a question (if used)  | ☐    |

---

## Every day and exam day

- **The PC must stay on and wired.** Settings → System → Power → Screen and sleep → **Never**
  for sleep.
- **Pause Windows Update** for exam weeks (Settings → Windows Update → Pause), so Windows doesn't
  restart during an exam.
- **Restarting Windows is safe**: Hyper-V shuts Ubuntu down first and starts it again after.
  Never pull the power plug during an exam.
- **Useful commands on the VM:**

  ```sh
  securelab ps                    # what is running
  securelab logs -f api worker    # what the server is doing (Ctrl+C to stop)
  ```

- **Backups.** The server makes one every night. Copy them to Windows before and after each
  exam, in normal PowerShell:

  ```powershell
  scp -r admin1@10.20.30.40:securelab/deploy/backups D:\SecureLab-backups
  ```

  Better still, copy them to a USB drive or a network drive too. Restoring is in the
  [backup and restore runbook](../ops/backup-restore.md).

- **Updating SecureLab** (never during an exam). Take a backup first, then on the VM:

  ```sh
  cd ~/securelab && git pull && ./deploy/one-machine.sh
  securelab --profile ai up -d    # only if you use AI help
  ```

## If something goes wrong

| Problem                                                | Fix                                                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| "requires elevation"                                   | Run PowerShell **as administrator** (step 1).                                                                                                |
| Hyper-V Manager says "You do not have permission"      | Add your account to Hyper-V Administrators (step 1), sign out and in.                                                                        |
| VM shows "No operating system was loaded" / won't boot | Secure Boot template is wrong. VM off, then `Set-VMFirmware -VMName SecureLab -SecureBootTemplate MicrosoftUEFICertificateAuthority`.        |
| Ubuntu installer has no network address                | Network blocks the VM. Ask IT, or see below.                                                                                                 |
| Windows lost its network after step 2b                 | The switch was made without `-AllowManagementOS $true`. Run `Set-VMSwitch -Name "Lab network" -AllowManagementOS $true` in admin PowerShell. |
| `ssh` times out                                        | VM is off or its address changed. In the VM window, sign in and run `ip -4 addr`.                                                            |
| Script: "didn't run the test program"                  | Run `stat -fc %T /sys/fs/cgroup`. If it isn't `tmpfs`, run the script again and reboot. Then see `docker logs` of the Judge0 workers.        |
| Browser says "not secure"                              | Certificate not trusted on that computer (step 8). Restart the browser after importing.                                                      |
| Student app: "can't reach the server"                  | Check `config.json` (step 9), then `curl.exe` from that lab PC.                                                                              |
| AI help "isn't set up"                                 | Run step 10 again. Check `grep AI_ ~/securelab/deploy/.env`.                                                                                 |
| Everything is slow during an exam                      | In Task Manager, check Windows isn't using all CPU. In the VM, run `top`. Turn AI help off for that exam if needed.                          |

### If the network blocks the VM

Some university networks allow only one device per wall socket. The best fix is to ask IT to
allow the VM's MAC address. If they can't, the VM can sit behind Windows instead: Windows forwards
ports 80 and 443 to it, and lab PCs use **the Windows PC's** address. In admin PowerShell:

```powershell
New-VMSwitch -Name "SecureLab NAT" -SwitchType Internal
New-NetIPAddress -IPAddress 192.168.50.1 -PrefixLength 24 -InterfaceAlias "vEthernet (SecureLab NAT)"
New-NetNat -Name SecureLabNAT -InternalIPInterfaceAddressPrefix 192.168.50.0/24
Connect-VMNetworkAdapter -VMName SecureLab -SwitchName "SecureLab NAT"
Add-NetNatStaticMapping -NatName SecureLabNAT -Protocol TCP -ExternalIPAddress 0.0.0.0 -ExternalPort 443 -InternalIPAddress 192.168.50.10 -InternalPort 443
Add-NetNatStaticMapping -NatName SecureLabNAT -Protocol TCP -ExternalIPAddress 0.0.0.0 -ExternalPort 80 -InternalIPAddress 192.168.50.10 -InternalPort 80
New-NetFirewallRule -DisplayName "SecureLab HTTPS" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
```

In Ubuntu, use step 4 B with address `192.168.50.10/24`, gateway `192.168.50.1` and DNS
`1.1.1.1` (or IT's DNS). Then give the **Windows PC's** fixed address to the script in step 6
(`./deploy/one-machine.sh 10.20.30.99`) and to the lab PCs' `config.json`. Windows itself
reaches the dashboard at `https://10.20.30.99/` too. Use ssh to `192.168.50.10` from this PC.

## Other PCs

- **Less memory (16 GB):** VM with 8 CPUs and 10 GB, and no AI help.
- **Windows Home:** no Hyper-V. Use VirtualBox, as in the [Windows server guide](windows-server.md).
- **Limits of one PC:** if this PC fails during an exam, the exam stops until it is back. Keep
  the paper fallback from the [incident runbook](../ops/incident-response.md) ready. For regular
  graded exams, ask IT for a Linux server, or two ([deployment guide](../../deploy/README.md)).
