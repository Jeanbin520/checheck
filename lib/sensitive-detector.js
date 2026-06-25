const RULES = [
  { type: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, severity: 'high', label: '疑似 OpenAI API Key' },
  { type: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: 'high', label: '疑似 Anthropic API Key' },
  { type: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, severity: 'high', label: '疑似 GitHub Token' },
  { type: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/gi, severity: 'high', label: '疑似 Bearer Token' },
  { type: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, severity: 'high', label: '疑似 JWT' },
  { type: 'cookie', pattern: /\b(cookie|set-cookie)\s*:\s*[^;\n]{20,}/gi, severity: 'high', label: '疑似 Cookie' },
  { type: 'authorization-header', pattern: /\bauthorization\s*:\s*[^\n]{12,}/gi, severity: 'high', label: '疑似 Authorization Header' },
  { type: 'env-secret', pattern: /\b[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*.+/g, severity: 'medium', label: '疑似 .env 密钥配置' },
  { type: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, severity: 'low', label: '可能包含邮箱地址' },
  { type: 'phone', pattern: /\b(?:\+?86[-\s]?)?1[3-9]\d{9}\b/g, severity: 'low', label: '可能包含手机号' },
  { type: 'private-ip', pattern: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g, severity: 'low', label: '可能包含内网 IP' }
];

function maskValue(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 12) return text;

  const bearer = text.match(/^Bearer\s+(.+)$/i);
  if (bearer) {
    const token = bearer[1];
    return `Bearer ...${token.slice(-4)}`;
  }

  const header = text.match(/^([A-Za-z-]+)\s*:\s*(.+)$/);
  if (header) {
    return `${header[1]}: ...${header[2].slice(-4)}`;
  }

  const env = text.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
  if (env) {
    return `${env[1]}=...${env[2].slice(-4)}`;
  }

  return `${text.slice(0, Math.min(6, Math.ceil(text.length / 3)))}...${text.slice(-4)}`;
}

export function detectSensitiveText(text) {
  const source = String(text || '');
  if (!source.trim()) return [];

  const grouped = new Map();
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    const previews = new Map();
    let match;
    while ((match = rule.pattern.exec(source))) {
      const raw = match[0];
      previews.set(maskValue(raw), true);
      if (previews.size >= 5) break;
    }
    if (previews.size === 0) continue;
    grouped.set(rule.type, {
      type: rule.type,
      severity: rule.severity,
      label: rule.label,
      preview: Array.from(previews.keys())[0],
      previews: Array.from(previews.keys()),
      count: previews.size
    });
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9) || a.label.localeCompare(b.label, 'zh-CN');
  });
}

export function summarizeSensitiveRisks(risks) {
  const items = Array.isArray(risks) ? risks : [];
  const high = items.filter(item => item.severity === 'high').length;
  const medium = items.filter(item => item.severity === 'medium').length;
  const low = items.filter(item => item.severity === 'low').length;
  return { total: items.length, high, medium, low };
}
