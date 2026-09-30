import type { Lang } from '@shared/constants';
import { APP_NAME } from '@shared/constants';

/**
 * Transactional e-mail copy. Kept separate from the UI catalogue (shared/src/i18n) because email needs
 * full sentences with layout, not short UI strings — but every language FinTrack supports is covered,
 * per the localisation requirement, using the recipient's own language preference.
 */
interface Dict {
  verifySubject: string;
  verifyTitle: string;
  verifyBody: (username: string) => string;
  verifyButton: string;
  verifyExpiry: string;
  resetSubject: string;
  resetTitle: string;
  resetBody: (username: string) => string;
  resetButton: string;
  resetExpiry: string;
  resetIgnore: string;
  passwordChangedSubject: string;
  passwordChangedTitle: string;
  passwordChangedBody: string;
  newDeviceSubject: string;
  newDeviceTitle: string;
  newDeviceBody: (device: string, location: string, when: string) => string;
  twoFactorEnabledSubject: string;
  twoFactorEnabledTitle: string;
  twoFactorEnabledBody: string;
  twoFactorDisabledSubject: string;
  twoFactorDisabledTitle: string;
  twoFactorDisabledBody: string;
  deletionRequestedSubject: string;
  deletionRequestedTitle: string;
  deletionRequestedBody: (date: string) => string;
  deletionCancelledSubject: string;
  deletionCancelledTitle: string;
  deletionCancelledBody: string;
  footerNotYou: string;
  footerAutomated: string;
}

const DICTS: Record<Lang, Dict> = {
  en: {
    verifySubject: `Verify your email for ${APP_NAME}`,
    verifyTitle: 'Confirm your email address',
    verifyBody: (u) => `Hi ${u}, welcome to ${APP_NAME}. Please confirm this is your email address to unlock your account.`,
    verifyButton: 'Verify email',
    verifyExpiry: 'This link expires in 24 hours.',
    resetSubject: `Reset your ${APP_NAME} password`,
    resetTitle: 'Reset your password',
    resetBody: (u) => `Hi ${u}, we received a request to reset your password.`,
    resetButton: 'Choose a new password',
    resetExpiry: 'This link expires in 1 hour.',
    resetIgnore: "If you didn't request this, you can safely ignore this email — your password will not change.",
    passwordChangedSubject: `Your ${APP_NAME} password was changed`,
    passwordChangedTitle: 'Your password was changed',
    passwordChangedBody: 'If this was you, no action is needed. If you did not make this change, secure your account immediately and contact support.',
    newDeviceSubject: `New sign-in to your ${APP_NAME} account`,
    newDeviceTitle: 'New sign-in detected',
    newDeviceBody: (device, location, when) => `Your account was just signed in from a new device: ${device}, ${location}, at ${when}. If this was you, no action is needed.`,
    twoFactorEnabledSubject: `Two-factor authentication enabled`,
    twoFactorEnabledTitle: 'Two-factor authentication is now on',
    twoFactorEnabledBody: 'Your account now requires a code from your authenticator app when signing in.',
    twoFactorDisabledSubject: `Two-factor authentication disabled`,
    twoFactorDisabledTitle: 'Two-factor authentication was turned off',
    twoFactorDisabledBody: 'If you did not do this, secure your account immediately and contact support.',
    deletionRequestedSubject: `Your ${APP_NAME} account is scheduled for deletion`,
    deletionRequestedTitle: 'Account deletion scheduled',
    deletionRequestedBody: (date) => `Your account and its data will be permanently deleted on ${date}. You can cancel this any time before then from Security Center.`,
    deletionCancelledSubject: `Account deletion cancelled`,
    deletionCancelledTitle: 'Account deletion cancelled',
    deletionCancelledBody: 'Your account will not be deleted and remains fully active.',
    footerNotYou: "If you didn't take this action, please contact support immediately.",
    footerAutomated: `This is an automated message from ${APP_NAME}.`,
  },
  ru: {
    verifySubject: `Подтвердите email для ${APP_NAME}`,
    verifyTitle: 'Подтвердите свой email',
    verifyBody: (u) => `Привет, ${u}! Добро пожаловать в ${APP_NAME}. Подтвердите, что это ваш email, чтобы разблокировать аккаунт.`,
    verifyButton: 'Подтвердить email',
    verifyExpiry: 'Ссылка действительна 24 часа.',
    resetSubject: `Сброс пароля ${APP_NAME}`,
    resetTitle: 'Сброс пароля',
    resetBody: (u) => `Привет, ${u}! Мы получили запрос на сброс пароля.`,
    resetButton: 'Задать новый пароль',
    resetExpiry: 'Ссылка действительна 1 час.',
    resetIgnore: 'Если вы не запрашивали это, просто проигнорируйте письмо — пароль не изменится.',
    passwordChangedSubject: `Пароль ${APP_NAME} был изменён`,
    passwordChangedTitle: 'Ваш пароль изменён',
    passwordChangedBody: 'Если это были вы — ничего делать не нужно. Если нет — немедленно защитите аккаунт и обратитесь в поддержку.',
    newDeviceSubject: `Новый вход в ваш аккаунт ${APP_NAME}`,
    newDeviceTitle: 'Обнаружен новый вход',
    newDeviceBody: (device, location, when) => `В ваш аккаунт только что вошли с нового устройства: ${device}, ${location}, в ${when}. Если это были вы — ничего делать не нужно.`,
    twoFactorEnabledSubject: `Двухфакторная аутентификация включена`,
    twoFactorEnabledTitle: 'Двухфакторная аутентификация включена',
    twoFactorEnabledBody: 'Теперь при входе потребуется код из приложения-аутентификатора.',
    twoFactorDisabledSubject: `Двухфакторная аутентификация отключена`,
    twoFactorDisabledTitle: 'Двухфакторная аутентификация отключена',
    twoFactorDisabledBody: 'Если это были не вы — немедленно защитите аккаунт и обратитесь в поддержку.',
    deletionRequestedSubject: `Удаление аккаунта ${APP_NAME} запланировано`,
    deletionRequestedTitle: 'Удаление аккаунта запланировано',
    deletionRequestedBody: (date) => `Ваш аккаунт и данные будут безвозвратно удалены ${date}. Вы можете отменить это в любой момент до наступления даты в Центре безопасности.`,
    deletionCancelledSubject: `Удаление аккаунта отменено`,
    deletionCancelledTitle: 'Удаление аккаунта отменено',
    deletionCancelledBody: 'Ваш аккаунт не будет удалён и остаётся полностью активным.',
    footerNotYou: 'Если это были не вы, немедленно обратитесь в поддержку.',
    footerAutomated: `Это автоматическое сообщение от ${APP_NAME}.`,
  },
  uz: {
    verifySubject: `${APP_NAME} uchun emailni tasdiqlang`,
    verifyTitle: 'Email manzilingizni tasdiqlang',
    verifyBody: (u) => `Salom, ${u}! ${APP_NAME}ga xush kelibsiz. Hisobingizni ochish uchun bu email sizga tegishli ekanini tasdiqlang.`,
    verifyButton: 'Emailni tasdiqlash',
    verifyExpiry: 'Havola 24 soat amal qiladi.',
    resetSubject: `${APP_NAME} parolini tiklash`,
    resetTitle: 'Parolni tiklash',
    resetBody: (u) => `Salom, ${u}! Parolni tiklash so'rovini oldik.`,
    resetButton: "Yangi parol o'rnatish",
    resetExpiry: 'Havola 1 soat amal qiladi.',
    resetIgnore: "Agar bu so'rovni siz yubormagan bo'lsangiz, xatni e'tiborsiz qoldiring — parolingiz o'zgarmaydi.",
    passwordChangedSubject: `${APP_NAME} paroli o'zgartirildi`,
    passwordChangedTitle: "Parolingiz o'zgartirildi",
    passwordChangedBody: "Agar bu siz bo'lsangiz, hech narsa qilish shart emas. Aks holda, hisobingizni darhol himoya qiling va qo'llab-quvvatlash xizmatiga murojaat qiling.",
    newDeviceSubject: `${APP_NAME} hisobingizga yangi kirish`,
    newDeviceTitle: 'Yangi kirish aniqlandi',
    newDeviceBody: (device, location, when) => `Hisobingizga yangi qurilmadan kirildi: ${device}, ${location}, ${when} da. Agar bu siz bo'lsangiz, hech narsa qilish shart emas.`,
    twoFactorEnabledSubject: `Ikki bosqichli autentifikatsiya yoqildi`,
    twoFactorEnabledTitle: 'Ikki bosqichli autentifikatsiya yoqildi',
    twoFactorEnabledBody: "Endi tizimga kirishda autentifikator ilovasidagi koddan foydalanish talab qilinadi.",
    twoFactorDisabledSubject: `Ikki bosqichli autentifikatsiya o'chirildi`,
    twoFactorDisabledTitle: "Ikki bosqichli autentifikatsiya o'chirildi",
    twoFactorDisabledBody: "Agar bu siz bo'lmasangiz, hisobingizni darhol himoya qiling va qo'llab-quvvatlash xizmatiga murojaat qiling.",
    deletionRequestedSubject: `${APP_NAME} hisobingizni o'chirish rejalashtirildi`,
    deletionRequestedTitle: "Hisobni o'chirish rejalashtirildi",
    deletionRequestedBody: (date) => `Hisobingiz va ma'lumotlaringiz ${date} sanasida butunlay o'chiriladi. Bu sanaga qadar Xavfsizlik markazidan bekor qilishingiz mumkin.`,
    deletionCancelledSubject: `Hisobni o'chirish bekor qilindi`,
    deletionCancelledTitle: "Hisobni o'chirish bekor qilindi",
    deletionCancelledBody: "Hisobingiz o'chirilmaydi va to'liq faol bo'lib qoladi.",
    footerNotYou: "Agar bu amalni siz bajarmagan bo'lsangiz, darhol qo'llab-quvvatlash xizmatiga murojaat qiling.",
    footerAutomated: `Bu ${APP_NAME}dan avtomatik xabar.`,
  },
};

function layout(title: string, bodyHtml: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
<tr><td style="background:#4f46e5;padding:24px 32px;"><span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:-0.02em;">${APP_NAME}</span></td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${title}</h1>
<div style="font-size:15px;line-height:1.6;color:#374151;">${bodyHtml}</div>
</td></tr>
<tr><td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #eef0f3;">
<p style="margin:0;font-size:12px;color:#9ca3af;">${footer}</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="text-align:center;margin:28px 0;"><a href="${url}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block;">${label}</a></p>
  <p style="font-size:12px;color:#9ca3af;word-break:break-all;">${url}</p>`;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const t = (lang: Lang): Dict => DICTS[lang] ?? DICTS.en;

export function verifyEmailMail(lang: Lang, username: string, url: string): EmailContent {
  const d = t(lang);
  const html = layout(d.verifyTitle, `<p>${d.verifyBody(username)}</p>${button(url, d.verifyButton)}<p style="color:#6b7280;">${d.verifyExpiry}</p>`, d.footerAutomated);
  return { subject: d.verifySubject, text: `${d.verifyBody(username)}\n\n${url}\n\n${d.verifyExpiry}`, html };
}

export function passwordResetMail(lang: Lang, username: string, url: string): EmailContent {
  const d = t(lang);
  const html = layout(
    d.resetTitle,
    `<p>${d.resetBody(username)}</p>${button(url, d.resetButton)}<p style="color:#6b7280;">${d.resetExpiry}</p><p style="color:#6b7280;">${d.resetIgnore}</p>`,
    d.footerAutomated,
  );
  return { subject: d.resetSubject, text: `${d.resetBody(username)}\n\n${url}\n\n${d.resetExpiry}\n${d.resetIgnore}`, html };
}

export function passwordChangedMail(lang: Lang): EmailContent {
  const d = t(lang);
  const html = layout(d.passwordChangedTitle, `<p>${d.passwordChangedBody}</p>`, d.footerNotYou);
  return { subject: d.passwordChangedSubject, text: d.passwordChangedBody, html };
}

export function newDeviceLoginMail(lang: Lang, device: string, location: string, when: string): EmailContent {
  const d = t(lang);
  const html = layout(d.newDeviceTitle, `<p>${d.newDeviceBody(device, location, when)}</p>`, d.footerNotYou);
  return { subject: d.newDeviceSubject, text: d.newDeviceBody(device, location, when), html };
}

export function twoFactorEnabledMail(lang: Lang): EmailContent {
  const d = t(lang);
  return { subject: d.twoFactorEnabledSubject, text: d.twoFactorEnabledBody, html: layout(d.twoFactorEnabledTitle, `<p>${d.twoFactorEnabledBody}</p>`, d.footerAutomated) };
}
export function twoFactorDisabledMail(lang: Lang): EmailContent {
  const d = t(lang);
  return { subject: d.twoFactorDisabledSubject, text: d.twoFactorDisabledBody, html: layout(d.twoFactorDisabledTitle, `<p>${d.twoFactorDisabledBody}</p>`, d.footerNotYou) };
}
export function deletionRequestedMail(lang: Lang, date: string): EmailContent {
  const d = t(lang);
  return { subject: d.deletionRequestedSubject, text: d.deletionRequestedBody(date), html: layout(d.deletionRequestedTitle, `<p>${d.deletionRequestedBody(date)}</p>`, d.footerNotYou) };
}
export function deletionCancelledMail(lang: Lang): EmailContent {
  const d = t(lang);
  return { subject: d.deletionCancelledSubject, text: d.deletionCancelledBody, html: layout(d.deletionCancelledTitle, `<p>${d.deletionCancelledBody}</p>`, d.footerAutomated) };
}
