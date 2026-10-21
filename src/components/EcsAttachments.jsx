import { useI18n } from '../i18n.jsx';
import { getEcsAttachment } from '../ecs.js';
import AttachmentCards from '../mail/AttachmentCards.jsx';

// Files stored with an ECS message's body (never in the email itself),
// decrypted here with the message's key.
export default function EcsAttachments({ id, message, ecsKey }) {
  const { t } = useI18n();
  const list = message.attachments || [];
  if (!list.length || message.withdrawn || message.locked) return null;
  const items = list.map((a, i) => ({
    key: `${id}/${Number.isInteger(a.slot) ? a.slot : i}`, name: a.name, type: a.type, size: a.size,
    load: () => getEcsAttachment(id, i, message, ecsKey),
  }));
  return <AttachmentCards items={items} label={t('attachments')} />;
}
