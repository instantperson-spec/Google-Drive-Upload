import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request) {
  try {
    const data = await request.json();
    console.log('Received notification data:', data);

    const files = data.files || [];
    const filesListText = files.map(f => `- \`${f.name}\` (${(f.size / 1024 / 1024).toFixed(2)} MB)`).join('\n');
    const filesListHtml = files.map(f => `<li><strong>${f.name}</strong> (${(f.size / 1024 / 1024).toFixed(2)} MB)</li>`).join('');

    const webhookUrl = process.env.WEBHOOK_URL;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `🚀 **New Upload Session!**\nUploader: \`${data.uploaderName}\` (${data.uploaderEmail})\nFiles:\n${filesListText}`
        })
      });
    }

    // Send Email via Nodemailer
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.NOTIFICATION_EMAIL) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '465'),
        secure: process.env.SMTP_PORT === '465', 
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const mailOptions = {
        from: `Drive Uploader <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: process.env.NOTIFICATION_EMAIL, 
        subject: `✅ New files uploaded by: ${data.uploaderName}`,
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #0056b3;">You have received new files!</h2>
            <p>User <strong>${data.uploaderName}</strong> (<a href="mailto:${data.uploaderEmail}">${data.uploaderEmail}</a>) has just uploaded a batch of files via your application.</p>
            
            <h3 style="margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 5px;">File list (${files.length}):</h3>
            <ul style="padding-left: 20px;">
              ${filesListHtml}
            </ul>

            <p style="margin-top: 30px; font-size: 14px; color: #666;">
              All files have been securely saved to a dedicated folder in your Google Drive ("${data.uploaderName} - ${data.uploaderEmail}").
            </p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log('Notification email sent to admin.');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error handling notification:', error);
    return NextResponse.json({ error: 'Failed to process notification' }, { status: 500 });
  }
}
