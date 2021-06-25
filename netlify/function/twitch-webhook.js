const crypto = require('crypto')
const Pusher = require("pusher");




/**
 * @typedef {import('@netlify/functions').HandlerEvent} HandlerEvent
 * @typedef {import('@netlify/functions').HandlerContext} HandlerContext
 * @typedef {import('@netlify/functions').HandlerResponse} HandlerResponse
 */


 const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true
});

/**
 *
 * @param {string} expected - the `x-hub-signature` header
 * @param {string} secret - our secret string
 * @param {string} body - the body of the request
 * @returns {boolean}
 * @link https://github.com/thedist/Twitch-Webhook-AWS-Tutorial/blob/f402b1575381fa77dc71e7994a056c3b5cc34444/src/twitch-webhook-post/index.js#L6-L10
 */
function twitchVerification(expected, secret, body) {
  const calculated = 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer(body)).digest('hex')
  return expected === calculated
}


/**
 *
 * @param {HandlerEvent} event
 * @param {HandlerContext} context
 * @returns {Promise<HandlerResponse>}
 */
exports.handler = async function (event, context) {

  const verified = twitchVerification(
      event.headers['Twitch-Eventsub-Message-Signature'],
      process.env.TWITCH_WEBHOOK_SECRET,
      event.headers['Twitch-Eventsub-Message-Id'] + event.headers['Twitch-Eventsub-Message-Timestamp'] + event.body
  );
  if (event.httpMethod === 'POST') {
    if(!verified) return {statusCode:403,body:"Verification failed."};

    let body;

    try{
      body = JSON.parse(event.body);
    }catch(e){
      return {statusCode:500, body:e};
    }

    if(event.headers['Twitch-Eventsub-Message-Type'] === 'webhook_callback_verification'){
      return {statusCode:200, body: body.challenge};
    }

    switch(event.headers['Twitch-Eventsub-Subscription-Type']){
      case 'channel.follow':
        // data transform goes here.
        pusher.trigger(process.env.TWITCH_USER_ID, "channel.follow", body);
        break;
    }

  }

  return {
    statusCode:200,
    body:"",
  }
}
