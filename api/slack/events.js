const { WebClient } = require('@slack/web-api');
const crypto = require('crypto');

const client = new WebClient(process.env.SLACK_BOT_TOKEN);
const TARGET_CHANNEL = 'ax_라운지';

function verifySlackSignature(req, rawBody) {
  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSignature = req.headers['x-slack-signature'];

  if (!timestamp || !slackSignature) return false;

  // 5분 이상 된 요청 거부
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(sigBase)
    .digest('hex');
  const computed = `v0=${hmac}`;

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSignature));
}

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const rawBody = await getRawBody(req);

  if (!verifySlackSignature(req, rawBody)) {
    return res.status(401).send('Unauthorized');
  }

  const body = JSON.parse(rawBody);

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
        const channelList = await client.conversations.list({
          types: 'public_channel,private_channel',
          limit: 1000,
        });

        const channel = channelList.channels.find(
          (c) => c.name === TARGET_CHANNEL
        );

        if (!channel) {
          await client.chat.postMessage({
            channel: event.channel,
            text: '채널을 찾을 수 없습니다. 관리자에게 문의해주세요.',
          });
          return res.status(200).send('ok');
        }

        await client.chat.postMessage({
          channel: channel.id,
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
