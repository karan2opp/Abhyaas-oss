import { Resend } from 'resend';
import 'dotenv/config';

// Initialize Resend with the API key from environment variables
export const resend = new Resend(process.env.EMAIL_API_KEY);

export const sendVerificationEmail = async (email: string, otp: string) => {
  try {
    console.log(`\n=========================================`);
    console.log(`=========================================\n`);

    const response = await resend.emails.send({
      from: 'Abiyaas <noreply@karanop.in>', // If unverified, Resend will return an error
      to: email,
      subject: 'Verify your email - Abiyaas',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
          <h2 style="color: #333; text-align: center;">Welcome to Abiyaas!</h2>
          <p style="color: #555; text-align: center; font-size: 16px;">Here is your verification code. Please enter it to complete your registration.</p>
          <div style="background-color: #f4f4f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #111;">${otp}</span>
          </div>
          <p style="color: #777; font-size: 12px; text-align: center;">This code will expire in 15 minutes.</p>
        </div>
      `,
    });

    if (response.error) {
      console.error("Resend API Error:", response.error);
      throw new Error(response.error.message);
    }

    console.log("Verification email sent successfully:", response.data);
    return response;
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};

export const sendResetPasswordEmail = async (email: string, otp: string) => {
  try {
    console.log(`\n=========================================`);
    console.log(`🔑 DEVELOPMENT PASSWORD RESET OTP FOR ${email}`);
    console.log(`OTP: ${otp}`);
    console.log(`=========================================\n`);

    const response = await resend.emails.send({
      from: 'Abiyaas <noreply@karanop.in>',
      to: email,
      subject: 'Reset Your Password - Abiyaas',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
          <h2 style="color: #333; text-align: center;">Password Reset</h2>
          <p style="color: #555; text-align: center; font-size: 16px;">You requested to reset your password. Please use the following code to reset it.</p>
          <div style="background-color: #f4f4f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #111;">${otp}</span>
          </div>
          <p style="color: #777; font-size: 12px; text-align: center;">This code will expire in 15 minutes.</p>
        </div>
      `,
    });

    if (response.error) {
      console.error("Resend API Error (Reset Password):", response.error);
      throw new Error(response.error.message);
    }

    console.log("Reset password email sent successfully:", response.data);
    return response;
  } catch (error) {
    console.error("Error sending reset password email:", error);
    throw error;
  }
};
