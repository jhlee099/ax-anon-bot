const { App, ExpressReceiver } = require('@slack/bolt');

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/api/slack/events',
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

const TARGET_CHANNEL = 'ax_라운지';

// 사용자가 봇에게 DM 보내면 익명으로 채널에 포스팅
app.message(async ({ message, client, say }) => {
  // 봇 메시지나 채널 메시지 무시, DM만 처리
  if (message.channel_type !== 'im') return;
  if (message.subtype) return;
  if (!message.text || message.text.trim() === '') return;

  try {
    // 채널 ID 조회
    const channelList = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000,
    });

    const channel = channelList.channels.find(
      (c) => c.name === TARGET_CHANNEL
    );

    if (!channel) {
      await say('채널을 찾을 수 없습니다. 관리자에게 문의해주세요.');
      return;
    }

    // 익명으로 채널에 포스팅
    await client.chat.postMessage({
      channel: channel.id,
      text: `💬 *익명 질문*\n\n${message.text}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `💬 *익명 질문*\n\n${message.text}`,
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

    // 질문자에게 확인 메시지
    await say('질문이 익명으로 등록됐습니다. 답변이 달리면 채널에서 확인하세요.');
  } catch (error) {
    console.error('Error:', error);
    await say('오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }
});

// Vercel serverless function
module.exports = receiver.app;
