const nodemailer = require('nodemailer');

// Set up a mock transporter or read from environment variables if present
// For local testing, we print credentials to terminal and also log them to local file or console.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  auth: {
    user: process.env.SMTP_USER || 'mock-user@linksnip.io',
    pass: process.env.SMTP_PASS || 'mock-password'
  }
});

/**
 * Sends an email (verification link or password reset token)
 * If using Ethereal/Mock SMTP, we print the instructions to console for ease of development.
 * @param {string} to 
 * @param {string} subject 
 * @param {string} text 
 * @param {string} html 
 */
async function sendEmail({ to, subject, text, html }) {
  console.log(`\n=================================================`);
  console.log(`✉️  EMAIL SENT TO: ${to}`);
  console.log(`📌 SUBJECT: ${subject}`);
  console.log(`📝 CONTENT:\n${text}`);
  console.log(`=================================================\n`);

  try {
    // If ethereal or live credentials are used
    if (process.env.SMTP_HOST || (process.env.SMTP_USER && process.env.SMTP_USER !== 'mock-user@linksnip.io')) {
      await transporter.sendMail({
        from: '"LinkSnip" <no-reply@linksnip.io>',
        to,
        subject,
        text,
        html
      });
    }
  } catch (err) {
    console.error('Error sending email via SMTP:', err.message);
    // Do not crash - local logs are sufficient for simulation/demo
  }
}

module.exports = {
  sendEmail
};
