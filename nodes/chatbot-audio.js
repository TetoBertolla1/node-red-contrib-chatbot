const _ = require('underscore');
const Path = require('path');
const sanitize = require('sanitize-filename');
const utils = require('../lib/helpers/utils');
const validators = require('../lib/helpers/validators');
const fetchers = require('../lib/helpers/fetchers-obj');
const ChatExpress = require('../lib/chat-platform/chat-platform');

const ValidExtensions = {
  'facebook': ['.mp3'],
  'telegram': ['.mp3'],
  'slack': ['.mp3']
};

module.exports = function(RED) {

  function ChatBotAudio(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    this.filename = config.filename;
    this.audio = config.audio;
    this.name = config.name;
    this.transports = ['telegram', 'slack', 'facebook'];

    this.on('input', function(msg) {

      let filename = node.filename;
      const name = node.name;
      const chatId = utils.getChatId(msg);
      const messageId = utils.getMessageId(msg);
      const transport = utils.getTransport(msg);
      const validExtensions = ValidExtensions[transport];

      // check if valid message
      if (!utils.isValidMessage(msg, node)) {
        return;
      }
      // check transport compatibility
      if (!ChatExpress.isSupported(transport, 'audio') && !utils.matchTransport(node, msg)) {
        return;
      }

      let content = utils.extractValue('filepath', 'audio', node, msg)
        || utils.extractValue('buffer', 'audio', node, msg)
        || utils.extractValue('filepath', 'filename', node, msg, false, true);
      let caption = utils.extractValue('string', 'caption', node, msg, false);

      // TODO: move the validate audio file to chat platform methods

      // get the content
      let fetcher = null;
      if (validators.filepath(content)) {
        fetcher = fetchers.file;
        filename = Path.basename(content);
      } else if (validators.url(content)) {
        fetcher = fetchers.url;
        filename = sanitize(name);
      } else if (validators.buffer(content)) {
        fetcher = fetchers.identity;
      } else if (_.isString(content) && content.length > 4064) {
        node.error('Looks like you are passing a very long string (> 4064 bytes) in the payload as image url or path\n'
          + 'Perhaps you are using a "Http request" and passing the result as string instead of buffer?');
        return;
      } else {
        node.error('Don\'t know how to handle: ' + content);
        return;
      }

      // if filename is still empty
      // todo move this into the then chain, use filename from fetcher and not from this context
      if (_.isEmpty(filename)) {
        if (!_.isEmpty(msg.filename)) {
          // try to get filename from a message if it comes from a node-red file node
          filename = Path.basename(msg.filename);
        } if (msg.payload != null && !_.isEmpty(msg.payload.filename)) {
          // try to get filename from a message if it comes from a node-red file node
          filename = Path.basename(msg.payload.filename);
        } else if (_.isString(msg.payload) && !_.isEmpty(msg.payload) && msg.payload.length < 256) {
          // use from payload, pay attention to huge text files
          filename = sanitize(msg.payload);
        } else if (!_.isEmpty(name)) {
          filename = sanitize(name);
        }
      }

      fetcher(content)
        // TODO: add here size check
        .then(file => {
          // if the file has a not a valid extension, stop it
          if (!_.isEmpty(file.extension) && !_(validExtensions).contains(file.extension)) {
            const error = 'Unsupported file format for audio node, allowed formats: ' + validExtensions.join(', '); 
            node.error(error);
            throw error;
          }
          return file;
        })
        .then(
          file => {
            // send out reply
            node.send({
              ...msg,
              payload: {
                type: 'audio',
                content: file.buffer,
                caption,
                filename,
                chatId: chatId,
                messageId: messageId,
                inbound: false
              }
            });
          },
          node.error
        );
    });
  }

  RED.nodes.registerType('chatbot-audio', ChatBotAudio);
};
