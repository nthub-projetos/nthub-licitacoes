import nodemailer from 'nodemailer';
import { config } from '../../core/config.js';

export async function sendTemporaryPassword(email: string, password: string) {
  if (!config.SMTP_HOST) throw new Error('SMTP não configurado.');
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    ...(config.SMTP_USER
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
      : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  try {
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: 'NTHUB · Redefinição de senha',
      text: `Você solicitou a redefinição da sua senha no NTHUB.\n\nSenha temporária: ${password}\n\nEla vale por 30 minutos e pode ser usada uma única vez. Ao entrar, cadastre uma nova senha para acessar o sistema.\n\nAcesse: ${config.APP_URL}\n\nSe não fez esta solicitação, ignore este e-mail. Sua senha atual permanece válida até a conclusão da redefinição.`,
    });
  } finally {
    transport.close();
  }
}
