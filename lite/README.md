# SecureLab Lite: try SecureLab on your Windows PC

Lite runs the real SecureLab on one computer, with no Docker, no virtual machine and no Judge0.
It includes the teacher dashboard in your browser, the student app, a sample exam and sample
students. It takes about **1.6 GB** in total. Use it to look around, try the student experience
and show colleagues.

> **Not for real exams.** Lite runs students' code directly on your PC, with no sandbox. A
> program could read your files or use the network. For real exams, use the full setup
> ([deployment guide](../deploy/README.md)), where Judge0 runs code in a locked sandbox. The
> server refuses to start in Lite mode when `NODE_ENV=production`.

## What to install (once)

| Program                         | Size         | Get it from                                               | Notes                                                                                                                                                                                        |
| ------------------------------- | ------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js 22 LTS**              | about 100 MB | <https://nodejs.org>                                      | Use the Windows installer and accept the defaults.                                                                                                                                           |
| **PostgreSQL 16**               | about 300 MB | <https://www.postgresql.org/download/windows/>            | In the installer, untick **pgAdmin** and **Stack Builder**. **Write down the password** it asks for. Keep port 5432.                                                                         |
| **Python 3**                    | about 100 MB | <https://www.python.org/downloads/>                       | Tick **Add python.exe to PATH** on the first screen.                                                                                                                                         |
| **A C/C++ compiler** (optional) | about 300 MB | [w64devkit](https://github.com/skeeto/w64devkit/releases) | Unpack it to `C:\w64devkit` and add `C:\w64devkit\bin` to PATH (Start → "Edit the system environment variables" → Environment Variables → Path → New). Skip it if Python answers are enough. |
| **SecureLab** itself            | about 900 MB | this repository                                           | Setup downloads its parts.                                                                                                                                                                   |

Then get SecureLab: on <https://github.com/hisham2028/SecureLab>, press **Code → Download ZIP**,
and unzip it, for example to `C:\SecureLab`. If you have Git, `git clone` works too.

## Set up (once, about 5 minutes)

Open **PowerShell** in the SecureLab folder. In File Explorer, open the folder, then type
`powershell` in the address bar and press Enter. Then run:

```powershell
node lite/securelab-lite.mjs setup
```

It checks which languages will work, asks for the PostgreSQL password you wrote down, downloads
and builds SecureLab's parts, creates a database called `securelab_lite`, and creates an admin
account.

## Start

```powershell
node lite/securelab-lite.mjs start
```

This starts the server and opens two windows:

- **The teacher dashboard** in your browser, at <http://localhost:8080>. The email and password
  are printed in PowerShell.
- **The student app.**

The first time, it also creates a sample exam, **SecureLab Lite demo**, with two questions and
three students. PowerShell prints their exam code, student IDs and PINs, which are also saved
in `lite/demo-students.txt`.

**Try a whole exam:**

1. In the dashboard, open **SecureLab Lite demo** and press **Start exam**.
2. In the student app, sign in with the exam code, a student ID and its PIN.
3. Write an answer, press **Run** to try it, then **Submit**. With verdicts on, the student
   sees "Accepted" or how many tests passed within seconds.
4. In the dashboard, watch the **Live** tab, open the student's seat, and look at **Results**.

To be a second student at the same time, run this in another PowerShell window:

```powershell
node lite/securelab-lite.mjs student
```

**Stop** with Ctrl+C in the PowerShell window that is running `start`. Your exams and results
stay in the database for next time.

## If something doesn't work

| Problem                                | Fix                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `node` is not recognized               | Install Node.js, then open a **new** PowerShell window.                                                                     |
| "The API stopped" right after start    | Usually the PostgreSQL password is wrong. Delete `lite/.env` and run setup again. The full error is in `lite/logs/api.log`. |
| C or C++ answers show "couldn't grade" | The compiler isn't on PATH. Install w64devkit as above, open a new PowerShell window, and run `gcc --version` to check.     |
| Python answers show "couldn't grade"   | Reinstall Python with **Add python.exe to PATH** ticked.                                                                    |
| Port 8080 or 3000 is busy              | Close the other program using it, or restart the PC.                                                                        |

## What's different from the full version

|                               | Lite                           | Full version                                                  |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------- |
| Runs on                       | one PC, Windows/Mac/Linux      | Linux servers (or an Ubuntu VM on Windows)                    |
| Student code runs             | directly on the PC, no sandbox | in Judge0's sandbox: no network, limited memory and processes |
| Memory limit per answer       | not enforced                   | enforced                                                      |
| HTTPS, backups, retention job | no                             | yes                                                           |
| Size                          | about 1.6 GB                   | about 30 GB                                                   |

Everything else is the same code: the dashboard, the student app, grading, marks, results and
monitoring. AI help is off in Lite.
