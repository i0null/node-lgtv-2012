#!/usr/bin/env node

var xpath = require('xpath');
var dom = require('xmldom').DOMParser;
var http = require('http');

function lgtv(config) {
    var host = config.host || '127.0.0.1';
    var port = config.port || 8080;

    this.agent = null;
    this.debug = true;

    this.mute_threshold = 2
    this.false_run = false

    var commands = {
        // Numbers
        '0': 2, '1': 3, '2': 4, '3': 5, '4': 6,
        '5': 7, '6': 8, '7': 9, '8': 10, '9': 11,
        // Arrows
        'UP': 12, 'DOWN': 13, 'LEFT': 14, 'RIGHT': 15,
        // Actions
        'POWER': 1, 'ENTER': 20, 'BACK': 23, 'EXIT': 412,
        // Volume 
        'VOL_UP': 24, 'VOL_DOWN': 25, 'MUTE': 26,
        // Adjust Channel
        'CH_UP': 27, 'CH_DOWN': 28, 'LAST': 403,
        // Colours
        'BLUE': 29, 'GREEN': 30, 'RED': 31, 'YELLOW': 32,
        // Play State
        'PLAY': 33, 'PAUSE': 34, 'STOP': 35,
        // Position
        'FF': 36, 'REWIND': 37, 'SKIP_FORWARD': 39, 'SKIP_BACKWARD': 39,
        // Record
        'RECORD': 40, 'RECORDING': 41, 'LIVE': 43,
        'ASPECT_RATIO': 46, 'INPUT': 47,
        // Lists Channels
        'EPG': 44, 'CHANNELS': 50, 'FAV': 404,
        // Menu
        'QMENU': 405, 'TELETEXT': 51,
        // Turn On Subs
        'SUBS': 49, 'AUDIO_DESC': 407,
        // 3D
        '3D': 400, 'GAME_3D': 401,
        // Identify
        'APPS': 417, 'INFO': 45, 'HOME': 21,
        // Not Implemented
        'REPEAT': 42,
        'PIP': 48, 'PIP_CH_UP': 414, 'PIP_CH_DOWN': 415,
        'MARK': 52, 'DASH': 402,
        'TEXT_OPTION': 406,
        'ENERGY_SAVING': 409,
        'AV_MODE': 410,
        'SIMPLINK': 411,
        'RESERVATION_PROGRAM_LIST': 413,
        'SWITCH_VIDEO': 416
    };
    
    function log(msg) { 
        if(this.debug) console.log(msg);
    }

    // --- [ HTTP Agent ] ---
    var http_agent = null;

    function getAgent(cb) {
        if (http_agent === null) http_agent = new http.Agent({
            maxSockets: 1, keepAlive: true, keepAliveMsecs: 500 
        })
        cb(http_agent)
    }

    // --- [ HTTP Request Methods ] ---
    function get(path, cb) {
        getAgent((agent) => { http.get({ host: host, port: port, path: path, agent: agent}, (response) => {
            var b = ''; 
            // Append the big D
            response.on('data', (d) => { b += d; });
            response.on('end', (err) => { cb(b); });
        }).on('error', function(error) {
            log('Error: Unable to get ' + path + ':' + error.message)
            cb('');
        }) });
    }

    function post(path, data, cb) { 
        var headers = {
            'Accept-Encoding': 'identity',
            'Content-Length': Buffer.byteLength(data),
            'Content-Type': 'application/atom+xml'
        };
        getAgent((agent) => {
            var request = http.request({
                agent: agent, host: host, port: port,
                method: 'POST', path: path, headers: headers, 
            }, (response) => { response.setEncoding('utf8');
                var body = ''; response.on('data', (d) => { body += d; });
                response.on('end', (err) => { 
                    cb(d); 
                });
            }).on('error', function(error) {
                log(`Error: Unable to get ${path} ${error.message}`);
                cb('');
            });
            request.write(data);
            request.end();
        });
    };

    // --- [ Send commands ] ---

    // Send Single Command
    function send_command(command, cb) {
        var cmd = commands[command.toUpperCase()];
        if(parseInt(cmd)) {
            post('/roap/api/command', `<?xml version='1.0' encoding='utf-8'?><command><name>HandleKeyInput</name><value>${cmd}</value></command>`, (body) => {
                try {
                    var doc = new dom().parseFromString(body);
                    cb(xpath.select('//ROAPErrorDetail/text()', doc).toString() == 'OK')
                } catch(error) {
                    log(`error send_command:  ${error.message}`)
                    cb(false)
                }
            });
        }
    }
    this.send_command = send_command
    this.locked = false

    // Send Multiple Commands
    function send_commands(cmds, cb) {
        function callback(value) {
            cb(value)
            this.locked = false
        }
        function run() { 
            if (this.locked = cmds.length > 0) send_command(cmds.shift(), (success) => {
                if (success) setTimeout(run, 200);
                else callback(false);
            });
            else callback(true); 
        };
        if(!this.locked) run();
    }

    // Return Volume/Mute Status
    this.get_volume = function(cb) {
        get('/roap/api/data?target=volume_info', (body) => {
            var doc = new dom().parseFromString(body);
            try {
                var volume = parseInt(xpath.select('//level/text()', doc).toString())
                cb({ 
                    level: volume,
                    mute: xpath.select('//mute/text()', doc).toString() == 'true'
                })
            } catch(error) {
                log('error get_volume: ' + error.message)
                cb({ level: 0, mute: false })
            }
        })
    }

    
    this.set_volume = function (to, cb) {
        this.get_volume((volume) => {
            if( diff = parseInt(to) - volume.level) {
                var action = 'UP';
                var cmds = [];
                if(to >= this.mute_threshold == volume.mute) cmds.push('MUTE')
                if(diff < 0)  { action = 'DOWN'; diff *= -1; } 
                while(diff-- > 0) cmds.push('VOL_' + action)
                if(cmds.length) send_commands(cmds, (err) => { cb(err); })
            }  else {
                log('TV is already at volume ' + to)
                cb(false);
            }
        })
    };

    this.pair_request = function(cb) {
        var data = `<?xml version='1.0' encoding='utf-8'?><auth><type>AuthKeyReq</type></auth>`;
        post('/roap/api/auth', data, (body) => {
            //var session = xpath.select('//session/text()', new dom().parseFromString(body)).toString()
            cb(true);
        })
    };

    this.new_session = function(key, cb) {
        if(parseInt(key) > 100000) {
            post('/roap/api/auth', `<?xml version='1.0' encoding='utf-8'?><auth><type>AuthReq</type><value>${key}</value></auth>`, (body) => {
                //var session = xpath.select('//session/text()', new dom().parseFromString(body)).toString()
                cb(this);
            })
        } else {
            log(`invalid auth key  ${key}`);
            cb(null);
        }
    };

    function channel(cb) {
        // Get Channel
        get('/roap/api/data?target=cur_channel', (body) => {
            try {
                var body = new dom().parseFromString(body);
                cb({
                    channel: parseInt(xpath.select('//major/text()', body).toString()),
                    name: xpath.select('//chname/text()', body).toString(),
                    program: xpath.select('//progName/text()', body).toString()
                })
            } catch(error) {
                log('get channel error: ' + action + ' by ' + diff);
                cb({ channel: 0, name: 'Unknown', program: 'Unknown' });
            }
        })
    }

    // Get Channel Info
    this.get_channel = function (cb) { channel((ch) => { cb(ch.channel); }); };
    this.get_title = function (cb) { channel((ch) => { cb(ch.name); }); };
    this.get_program = function (cb) { channel((ch) => { cb(ch.program); }); };

    // Get Channel
    this.get_channels = function(cb) {
        get('/roap/api/data?target=channel_list', (body) => {
            var channels = {};
            try {
                var xpath = new dom().parseFromString(body);
                xpath.select('//data').forEach(function(ch) {
                    var number = ch.select('minor/text()').toString();
                    channels[number] = {
                        'name': ch.select('chname/text()').toString(),
                        'isRadio': bool(number != ch.select('major/text()').toString())
                    }
                });
            } catch(error) {
                log('get channel error: ' + action + ' by ' + diff);
            } finally {
                cb(channels);
            }
        });
    };

    this.turn_off = function(cb) {
        send_command('POWER', (err) => { cb(err); });
        getAgent((agent) => { agent.destroy(); });
    };

    this.set_channel = function(to_channel, cb) {
        var cmds = to_channel.toString().split('');
        if (cmds.length && parseInt(to_channel)) {
            log('Setting TV [' + host + '] to channel: ' + to_channel); 
            cmds.push('ENTER');
            if(this.false_run) { cb(false) }
            else { send_commands(cmds, (err) => { cb(true) }) }
        } else {
            log('Not a valid channel'); 
            cb(false)
        }
    }
}

module.exports = { lgtv: lgtv }