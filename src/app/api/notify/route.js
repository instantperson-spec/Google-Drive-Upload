import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request) {
  try {
    const data = await request.json();
    console.log('Received notification data:', data);

    const files = data.files || [];
    
    // For webhook / admin email text
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
      }).catch(err => console.error('Webhook error:', err));
    }

    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '465'),
        secure: process.env.SMTP_PORT === '465', 
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      // 1. Send Email to ADMIN
      if (process.env.NOTIFICATION_EMAIL) {
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
        await transporter.sendMail(mailOptions).catch(err => console.error('Admin email error:', err));
        console.log('Notification email sent to admin.');
      }

      // 2. Send Summary Email to UPLOADER
      if (data.uploaderEmail) {
        const successFiles = files.filter(f => f.status === 'completed');
        const failedFiles = files.filter(f => f.status !== 'completed');

        const successListHtml = successFiles.length > 0 ? 
          `<ul style="padding-left: 20px;">${successFiles.map(f => `<li><strong>${f.name}</strong> (${(f.size / 1024 / 1024).toFixed(2)} MB)</li>`).join('')}</ul>` : '<p>None.</p>';
        
        const failedListHtml = failedFiles.length > 0 ? 
          `<ul style="padding-left: 20px;">${failedFiles.map(f => `<li><strong>${f.name}</strong> - <em>Error or incomplete</em></li>`).join('')}</ul>` : '';

        const failedSection = failedFiles.length > 0 ? `
          <h3 style="margin-top: 20px; color: #ef4444; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Failed / Incomplete files:</h3>
          ${failedListHtml}
          <p style="font-size: 13px;">You can resume the upload of these files by returning to the website and selecting them again. The system will automatically skip what has already been uploaded.</p>
        ` : '';

        const clientMailOptions = {
          from: `Drive Uploader <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
          to: data.uploaderEmail,
          subject: `Upload Summary: ${successFiles.length} files successfully uploaded`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #eee; border-radius: 8px;">
              <h2 style="color: #4ade80; margin-top: 0;">Upload Complete</h2>
              <p>Hello <strong>${data.uploaderName}</strong>,</p>
              <p>Thank you for your upload. Here is the summary of your file transfer:</p>
              
              <h3 style="margin-top: 20px; color: #0056b3; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Successfully uploaded files (${successFiles.length}):</h3>
              ${successListHtml}
              
              ${failedSection}

              <p style="margin-top: 40px; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 10px;">
                This is an automated message. Please do not reply to this email.
              </p>
            </div>
          `
        };

        await transporter.sendMail(clientMailOptions).catch(err => console.error('Uploader email error:', err));
        console.log('Summary email sent to uploader.');
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error handling notification:', error);
    return NextResponse.json({ error: 'Failed to process notification' }, { status: 500 });
  }
}
