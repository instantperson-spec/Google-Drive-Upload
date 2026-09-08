# Direct Drive Uploader

A modern, glassmorphism-themed web application built with Next.js that allows users or clients to upload large files directly to a specific Google Drive folder. It bypasses the need for the uploader to have a Google account and uses resumable uploads for maximum stability with large files (like video footage).

## 🚀 Features

- **Direct to Google Drive:** Files are uploaded straight from the user's browser to your Google Drive, bypassing server bandwidth and storage limits.
- **Resumable Uploads (OAuth2):** Utilizes Google Drive API v3 Resumable Uploads via an OAuth2 Refresh Token. This entirely bypasses the strict upload limits associated with traditional Google Service Accounts.
- **Session Folders:** Automatically creates a uniquely named subfolder in your Drive for every upload session (formatted with the user's name, email, and timestamp) to keep incoming files organized.
- **Folder Upload Support:** Users can select entire directories (via `webkitdirectory`), preserving their local file selections.
- **SMTP Notifications:** Sends an automatic email notification to the administrator as soon as an upload session is successfully completed.
- **Modern UI:** Features a sleek, responsive dark-mode glassmorphism interface.

## 🛠 Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router)
- **Frontend:** React, Vanilla CSS (Glassmorphism UI)
- **API:** Google Drive API v3
- **Email:** Nodemailer (SMTP)

## ⚙️ Setup & Installation

### 1. Google Cloud Console Setup
To use this application, you must create an OAuth2 application in Google Cloud:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and enable the **Google Drive API**.
3. Configure the **OAuth Consent Screen** (set it to External, add `https://www.googleapis.com/auth/drive.file` scope).
4. Create **OAuth 2.0 Client IDs** (Web application). Add `https://developers.google.com/oauthplayground` to the Authorized redirect URIs.
5. Generate a **Refresh Token** using the [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground) with your Client ID and Secret.

### 2. Environment Variables
Rename `.env.example` to `.env.local` and fill in your details:

```env
# Google OAuth2 Credentials
GOOGLE_CLIENT_ID="your_client_id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your_client_secret"
GOOGLE_REFRESH_TOKEN="your_refresh_token"

# The ID of the main Google Drive folder where all session folders will be created
GOOGLE_DRIVE_FOLDER_ID="your_folder_id"

# SMTP Email Notification Settings
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="465"
SMTP_USER="your_email@gmail.com"
SMTP_PASS="your_app_password"
SMTP_FROM="your_email@gmail.com"
NOTIFICATION_EMAIL="your_destination_email@gmail.com"
```

### 3. Local Development
```bash
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 🌐 Deployment
This project is optimized for deployment on **Vercel**. 
Simply run `npx vercel` in the project directory, and don't forget to copy all your environment variables into the Vercel Dashboard under **Settings -> Environment Variables**.

## 🤝 Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the issues page or fork the repository if you have an idea for an improvement.

## 📝 License
This project is open-source and available under the [MIT License](LICENSE).
