const crypto = require('crypto')
const Pusher = require("pusher")
const {ClientCredentialsAuthProvider} = require("twitch-auth")
const {ApiClient} = require("twitch")

/**
 * @typedef {import('@netlify/functions').HandlerEvent} HandlerEvent
 * @typedef {import('@netlify/functions').HandlerContext} HandlerContext
 * @typedef {import('@netlify/functions').HandlerResponse} HandlerResponse
 */

const {
  PUSHER_APP_ID,
  PUSHER_KEY,
  PUSHER_SECRET,
  PUSHER_CLUSTER,
  TWITCH_API_CLIENT_ID,
  TWITCH_API_CLIENT_SECRET,
  TWITCH_WEBHOOK_SECRET,
  TWITCH_USER_ID,
  DEBUG_CALLBACK,
} = process.env

const pusher = new Pusher({
  appId: PUSHER_APP_ID,
  key: PUSHER_KEY,
  secret: PUSHER_SECRET,
  cluster: PUSHER_CLUSTER,
  useTLS: true,
})


function debugLog(...args){
  console.log(args);
  if(DEBUG_CALLBACK) {
    return pusher.trigger(TWITCH_USER_ID, "debug", args);
  }
}

const ALLOWED_ACTIONS = ['subscribe', 'unsubscribe']
const ALLOWED_EVENT_SUB_TYPES = ['channel.follow']

/**
 *
 * @param {string} expected - the `x-hub-signature` header
 * @param {string} secret - our secret string
 * @param {string} body - the body of the request
 * @returns {boolean}
 * @link https://github.com/thedist/Twitch-Webhook-AWS-Tutorial/blob/f402b1575381fa77dc71e7994a056c3b5cc34444/src/twitch-webhook-post/index.js#L6-L10
 */
function twitchVerification(expected, secret, body) {
  const calculated = 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')
  return expected === calculated
}


/**
 *
 * @param {HandlerEvent} event
 * @param {HandlerContext} context
 * @returns {Promise<HandlerResponse>}
 */
exports.handler = async function (event, context) {

  debugLog('event', event);
  if (event.httpMethod === 'GET') {

    const {action, type} = event.queryStringParameters

    if (!ALLOWED_ACTIONS.includes(action)) {
      return {
        statusCode: 400,
        body: `action must be one of the following: ${ALLOWED_ACTIONS.join(', ')}`,
      }
    }

    if (!ALLOWED_EVENT_SUB_TYPES.includes(type)) {
      return {
        statusCode: 400,
        body: `type must be one of the following: ${ALLOWED_EVENT_SUB_TYPES.join(', ')}`,
      }
    }


    const authProvider = new ClientCredentialsAuthProvider(TWITCH_API_CLIENT_ID, TWITCH_API_CLIENT_SECRET)
    const apiClient = new ApiClient({authProvider})

    let currentSubs
    try {
      currentSubs = await apiClient.helix.eventSub.getSubscriptionsForStatus('enabled')
      debugLog('current-subs',currentSubs);
    } catch (e) {
      return {
        statusCode: 500,
        body: `could not fetch subscriptions`,
      }
    }
    const typeSub = currentSubs.data.find((sub) => {
      return sub.type === type
    })
    let result = {
      statusCode: 400,
      body: `That didn't work. Alex, please make a better error message.`,
    }
    if (action === 'subscribe' && !typeSub) {
      const callback = event.rawUrl.split('?')[0];
      switch (type) {
        case 'channel.follow':
          try {

            result = await apiClient.helix.eventSub.subscribeToChannelFollowEvents(TWITCH_USER_ID, {secret:TWITCH_WEBHOOK_SECRET,method:'webhook',callback})
            debugLog('subscribe-channel.follow', callback, result);
          } catch(e){
            return {
              statusCode: 500,
              body: "The attempted subscription failed",
            }
          }
          return {
            statusCode: 200,
            body: JSON.stringify(result.body),
          }
      }
    } else if (action === 'unsubscribe' && typeSub) {
      const result = await apiClient.helix.eventSub.deleteSubscription(typeSub.id)
      return {
        statusCode: 200,
        body: JSON.stringify(result),
      }
    } else {
      return result;
    }
  }


  if (event.httpMethod === 'POST') {

    const verified = twitchVerification(
        event.headers['twitch-eventsub-message-signature'],
        TWITCH_WEBHOOK_SECRET,
        event.headers['twitch-eventsub-message-id'] + event.headers['twitch-eventsub-message-timestamp'] + event.body,
    )

    if (!verified) return {statusCode: 403, body: "Verification failed."}

    let body

    try {
      body = JSON.parse(event.body)
    } catch (e) {
      return {statusCode: 500, body: e}
    }

    if (event.headers['twitch-eventsub-message-type'] === 'webhook_callback_verification') {
      debugLog('callback-verification', body);
      return {statusCode: 200, body: body.challenge}
    }

    switch (event.headers['twitch-eventsub-subscription-type']) {
      case 'channel.follow':
        // data transform goes here.
        await pusher.trigger(TWITCH_USER_ID, "channel.follow", body)
        break
    }

  }

  return {
    statusCode: 200,
    body: "",
  }
}
