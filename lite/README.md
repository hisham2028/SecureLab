# SecureLab Lite: the web version on one PC

Lite runs the real SecureLab on one Windows (or Mac/Linux) computer, with no Docker and no
Judge0. That computer is the exam server. Students take the exam **in a web browser**, on the
same computer or on any computer on the same network (lab LAN or Wi-Fi): they open a link, with
nothing to install.

Students' Python, C and C++ code runs as **WebAssembly inside the server**, so you don't install
Python or a compiler either. A program can only read its input and print its output: no files,
no network, limited memory and time.

## What to install on the server PC (once)

| Program                     | Get it from                                    | Notes                                                                                                                |
| --------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Node.js 22.13 or newer**  | <https://nodejs.org> (the LTS)                 | Use the Windows installer and accept the defaults.                                                                   |
| **PostgreSQL 16**           | <https://www.postgresql.org/download/windows/> | In the installer, untick **pgAdmin** and **Stack Builder**. **Write down the password** it asks for. Keep port 5432. |
| **SecureLab** (this folder) | the zip, or the GitHub repository              | Unzip it, for example to `C:\SecureLab`.                                                                             |

Student computers need only a web browser (Chrome, Edge or Firefox).

## Set up (once, about 5 minutes)

Open **PowerShell** in the SecureLab folder: in File Explorer, open the folder, type
`powershell` in the address bar and press Enter. Then run:

```powershell
node lite/securelab-lite.mjs setup
```

It asks for the PostgreSQL password you wrote down, downloads and builds SecureLab's parts
(about 1 GB), creates a database called `securelab_lite`, and creates an admin account.

## Start

```powershell
node lite/securelab-lite.mjs start
```

It prints, and opens in your browser:

- **The teacher dashboard**: <http://localhost:8080>, with the email and password.
- **The student page**: <http://localhost:8080/student/> on this computer, and links such as
  `http://192.168.1.20:8080/student/` for the other computers on the network. Give students
  that link (write it on the board).

The first time Windows asks whether Node.js may use the network: tick **Private networks** and
press **Allow**. Without that, other computers can't open the student page.

The first time, Lite also creates a sample exam, **SecureLab Lite demo**, with two questions and
three students. PowerShell prints their exam code, student IDs and PINs (also saved in
`lite/demo-students.txt`).

**Try a whole exam:**

1. In the dashboard, open **SecureLab Lite demo** and press **Start exam**.
2. On the student page, sign in with the exam code, a student ID and its PIN, tick the box and
   press **Start exam**.
3. Write an answer, press **Run** to try it, then **Submit**.
4. In the dashboard, watch the **Live** tab, open the student's seat, and look at **Results**.

For your own exams: **Exams → New exam**, add questions, import students from a CSV (the
dashboard shows each student's PIN), then **Publish** and **Start exam**.

**Stop** with Ctrl+C in the PowerShell window. Exams and results stay in the database for next
time.

## Locked-screen exams in a browser

A web page can't stop students from switching apps the way the desktop app can. With **Lock
students' screens** on (the default):

- The exam opens full screen. If a student leaves full screen, the exam is covered until they
  return, and switching away is recorded in the dashboard's **Live** tab.
- Closing the tab (or the browser) submits the student's latest saved code and blocks the seat.
  They can only come back after you press **Unblock** in the dashboard. Reloading the page
  counts as closing it.

For exams where switching apps must be impossible, use the desktop student app on lab PCs
(`node lite/securelab-lite.mjs student` opens one here; see the full version's guides).

## If something doesn't work

| Problem                                     | Fix                                                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `node` is not recognized                    | Install Node.js, then open a **new** PowerShell window.                                                                     |
| "Node.js 22.13 or newer is needed"          | Install the current LTS from nodejs.org.                                                                                    |
| "The API stopped" right after start         | Usually the PostgreSQL password is wrong. Delete `lite/.env` and run setup again. The full error is in `lite/logs/api.log`. |
| Other computers can't open the student page | Allow Node.js through Windows Firewall (Start → "Allow an app through Windows Firewall" → Node.js → Private). Same network? |
| Port 8080 or 3000 is busy                   | Close the other program using it, or restart the PC.                                                                        |

## Good to know

- The first C or C++ answer after starting takes a few seconds longer: the compiler loads once.
- Python runs slower than a normal Python install (several times, for heavy loops). Typical exam
  answers finish well within a second; give heavy questions a generous time limit.
- In C++, a `throw` ends the program (a `catch` never runs); everything else in C++17 works,
  including `<bits/stdc++.h>`.
- The connection is plain HTTP on your network. For exams over the internet, use HTTPS: see
  the full version's [deployment guide](../deploy/README.md).
- AI help is off in Lite.
