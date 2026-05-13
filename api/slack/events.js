const { WebClient } = require('@slack/web-api');
const crypto = require('crypto');

const client = new WebClient(process.env.SLACK_BOT_TOKEN);
const TARGET_CHANNEL_ID = 'C0AUZDBKGLW';

function verifySlackSignature(timestamp, slackSignature, rawBody) {
  if (!timestamp || !slackSignature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(sigBase)
    .digest('hex');
  const computed = `v0=${hmac}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSignature));
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // Vercel은 body를 이미 파싱해서 req.body로 넘김
  // 서명 검증용 rawBody는 req.body를 다시 직렬화
  const body = req.body;
  const rawBody = JSON.stringify(body);

  // URL 검증 challenge
  if (body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  // 이벤트 처리
  if (body.event) {
    const event = body.event;

    // DM 메시지만 처리
    if (
      event.type === 'message' &&
      event.channel_type === 'im' &&
      !event.subtype &&
      event.text &&
      event.text.trim() !== ''
    ) {
      try {
        await client.chat.postMessage({
          channel: TARGET_CHANNEL_ID,
          text: `💬 *익명 질문*\n\n${event.text}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `💬 *익명 질문*\n\n${event.text}`,
              },
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
        console.error('Error:', error);
      }
    }
  }

  return res.status(200).send('ok');
};
