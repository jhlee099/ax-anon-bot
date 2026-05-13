const { WebClient } = require('@slack/web-api');

const TARGET_CHANNEL_ID = 'C0AUZDBKGLW';

// 메모리 캐시 (서버리스 인스턴스 단위)
const processedEvents = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const MAX_CACHE_SIZE = 1000;

// 폭주 방지: 분당 발송 제한
const rateWindow = []; // 최근 발송 timestamp 목록
const RATE_LIMIT_PER_MIN = 20;

function pruneCache() {
  const now = Date.now();
  for (const [id, ts] of processedEvents) {
    if (now - ts > CACHE_TTL_MS) processedEvents.delete(id);
  }
  if (processedEvents.size > MAX_CACHE_SIZE) {
    const overflow = processedEvents.size - MAX_CACHE_SIZE;
    const keys = Array.from(processedEvents.keys()).slice(0, overflow);
    keys.forEach((k) => processedEvents.delete(k));
  }
}

function checkRateLimit() {
  const now = Date.now();
  while (rateWindow.length && now - rateWindow[0] > 60_000) rateWindow.shift();
  if (rateWindow.length >= RATE_LIMIT_PER_MIN) return false;
  rateWindow.push(now);
  return true;
}

module.exports = async (req, res) => {
  // 1. 무조건 GET/기타 메서드 거부
  if (req.method !== 'POST') {
    return res.status(200).send('ok');
  }

  let body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(200).send('ok');
  }

  // 2. URL 검증 challenge
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  // 3. 글로벌 킬 스위치 - 환경변수로 즉시 중단 가능
  if (process.env.BOT_DISABLED === 'true') {
    return res.status(200).send('ok');
  }

  // 4. 토큰 없으면 즉시 중단
  if (!process.env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN === 'disabled') {
    return res.status(200).send('ok');
  }

  // 5. Slack 재시도 요청은 무조건 무시 (큐 폭주 차단)
  if (req.headers['x-slack-retry-num']) {
    return res.status(200).send('ok');
  }

  // 6. 5분 이상 된 이벤트 무시 (큐 잔여물 차단)
  const event = body.event;
  if (event && event.event_ts) {
    const eventAgeMs = Date.now() - Number(event.event_ts) * 1000;
    if (eventAgeMs > 5 * 60 * 1000) {
      return res.status(200).send('ok');
    }
  }

  // 7. 중복 이벤트 ID 차단
  const eventId = body.event_id;
  if (eventId) {
    pruneCache();
    if (processedEvents.has(eventId)) {
      return res.status(200).send('ok');
    }
    processedEvents.set(eventId, Date.now());
  }

  // 8. 이벤트 타입 검증
  if (!event || event.type !== 'message') {
    return res.status(200).send('ok');
  }

  // 9. DM이 아니거나, 봇 메시지거나, subtype 있으면 무시 (무한루프 방지)
  if (
    event.channel_type !== 'im' ||
    event.subtype ||
    event.bot_id ||
    event.bot_profile ||
    !event.text ||
    event.text.trim() === ''
  ) {
    return res.status(200).send('ok');
  }

  // 10. 분당 발송 제한
  if (!checkRateLimit()) {
    return res.status(200).send('ok');
  }

  // 11. 처리 전 먼저 200 응답 (Slack 재시도 차단)
  res.status(200).send('ok');

  // 12. 비동기로 실제 처리 (에러 나도 재시도 없음)
  try {
    const client = new WebClient(process.env.SLACK_BOT_TOKEN);
    const MAX_LENGTH = 100;
    const rawText = event.text;
    const text =
      rawText.length > MAX_LENGTH
        ? rawText.slice(0, MAX_LENGTH) + '...'
        : rawText;

    await client.chat.postMessage({
      channel: TARGET_CHANNEL_ID,
      text: `💬 *익명 질문*\n\n${text}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `💬 *익명 질문*\n\n${text}` },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '익명으로 제출된 질문입니다. 스레드로 답변해주세요.',
            },
          ],
        },
      ],
    });

    await client.chat.postMessage({
      channel: event.channel,
      text: '질문이 익명으로 등록됐습니다. 답변이 달리면 채널에서 확인하세요.',
    });
  } catch (error) {
    console.error('Error posting message:', error.message);
  }
};
