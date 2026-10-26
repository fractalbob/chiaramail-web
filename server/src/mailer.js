// Sends the sign-in codes by email, through the operator's own SMTP server
// (an OVHcloud mailbox, say). The code is also in the subject, so the desktop
// app can find the email in the person's inbox and sign in by itself.
import nodemailer from 'nodemailer';

const TEXT = {
  fr: {
    subject: (code, ref) => `ChiaraMail : votre code ${code} (réf. ${ref})`,
    body: (code) => `Votre code de connexion à ChiaraMail est :\n\n    ${code}\n\nIl est valable 15 minutes. Saisissez-le là où ChiaraMail le demande (l’application de bureau le saisit d’elle-même), puis vous pouvez supprimer cet e-mail.\n\nSi vous n’avez pas demandé ce code, ignorez ce message : personne ne peut se connecter sans lui.\n`,
  },
  en: {
    subject: (code, ref) => `ChiaraMail: your code ${code} (ref. ${ref})`,
    body: (code) => `Your ChiaraMail sign-in code is:\n\n    ${code}\n\nIt is valid for 15 minutes. Enter it where ChiaraMail asks for it (the desktop app enters it by itself), then you can delete this email.\n\nIf you didn't ask for this code, ignore this message: nobody can sign in without it.\n`,
  },
};

export function smtpMailer({ host, port, secure, user, pass, from }) {
  const t = nodemailer.createTransport({ host, port: Number(port), secure: secure !== 'false' && secure !== false, auth: user ? { user, pass } : undefined });
  return {
    from,
    async sendCode(to, code, ref, lang) {
      const x = TEXT[lang] || TEXT.fr;
      await t.sendMail({ from, to, subject: x.subject(code, ref), text: x.body(code) });
    },
  };
}

/** For tests: keeps what would have been sent. */
export function memoryMailer(from = 'codes@ecs.test') {
  const sent = [];
  return {
    from,
    sent,
    async sendCode(to, code, ref, lang) {
      const x = TEXT[lang] || TEXT.fr;
      sent.push({ to, code, ref, subject: x.subject(code, ref) });
    },
  };
}
