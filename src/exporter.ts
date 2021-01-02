import stream from 'stream';
import { BaseTag, createStream, QualifiedAttribute, Tag } from 'sax';
import { promisify } from 'util';
import got from 'got';
import Debug from "debug";
import { Registry, collectDefaultMetrics, Gauge, register } from "prom-client";
import express from "express";

const debug = Debug("hm-exporter");
const METRIC_PREFIX = 'hm_';

interface MetricsDescription {
    metricName: string
    help: string
}

const METRICS: { [key: string]: MetricsDescription } = {
    'ACTUAL_TEMPERATURE': {
        metricName: 'temperature',
        help: 'Actual temperature in C'
    },
    'STATE': {
        metricName: 'state',
        help: 'tbd'
    },
    'ACTUAL_HUMIDITY': {
        metricName: 'humidity',
        help: 'Actual humidity in %'
    },
    'WINDOW_STATE': {
        metricName: 'windowState',
        help: 'State of the window 1 for open and 0 for closed'
    },
    'VALVE_STATE': {
        metricName: 'ventil_state',
        help: 'Open state of the ventil of the heating in %'
    },
    'LEVEL': {
        metricName: 'ventil_level',
        help: 'Ventol level of the heating'
    },
    'BATTERY_STATE': {
        metricName: 'battery',
        help: 'Battery voltage level in Volt'
    },
    'SET_TEMPERATURE': {
        metricName: 'target_temperature',
        help: 'Target temperature that is configured on the device at the moment'
    },
    'RSSI_DEVICE': {
        metricName: 'rssi_receive',
        help: 'Signal strength from CCU to Device, negative in DB'
    },
    'RSSI_PEER': {
        metricName: 'rssi_send',
        help: 'Signal strength from Device to CCO, negative in DB'
    },
    'TEMPERATURE': {
        metricName: 'measured_temperature',
        help: 'Temperature actually measured by the wall thermostat'
    },
    'HUMIDITY': {
        metricName: 'measured_humidity',
        help: 'Humidity actually measured by the wall thermostat'
    },
    'MANU_MODE': {
        metricName: 'manual_set_temperature',
        help: 'Manually set target temperature'
    },
    'OPERATING_VOLTAGE': {
        metricName: 'operating_voltage',
        help: 'Operating Voltage in Volts'
    },
    'CURRENT': {
        metricName: 'current',
        help: 'Current in mA'
    },
    'ENERGY_COUNTER': {
        metricName: 'energy_counter',
        help: 'Consumed energy in Wh'
    },
    'FREQUENCY': {
        metricName: 'frequency',
        help: 'Electrical current frequency in Hz'
    },
    'POWER': {
        metricName: 'power',
        help: 'Current power consumption in W'
    },
    'VOLTAGE': {
        metricName: 'current_voltage',
        help: 'Current current voltage'
    },
    'ILLUMINATION': {
        metricName: 'illumination',
        help: 'Current illumination of the illumination sensor'
    },
    'MOTION': {
        metricName: 'motion',
        help: 'Motion detected status (1==true)'
    },
    'PRESENCE_DETECTION_STATE': {
        metricName: 'presence',
        help: 'State of the presence, 1==presence detected'
    }
};

// Create gauges
const gauges: { [key: string]: Gauge<string> } = {};
for (const [metric, desc] of Object.entries(METRICS)) {
    gauges[metric] = new Gauge({
        name: METRIC_PREFIX + desc.metricName,
        help: desc.help,
        labelNames: ['device', 'type', 'address']
    })
}

collectDefaultMetrics({ gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5] });

const server = express();
server.get('/metrics', async (req, res) => {
    try {
        await fetchValues();
        res.set('Content-Type', register.contentType);
        res.end(register.metrics());
    } catch (ex) {
        console.error(ex);
        res.status(500).end(ex);
    }
});


async function fetchValues() {
    const URL = `http://192.168.178.12/addons/xmlapi/statelist.cgi`
    const saxStream = createStream(true, { lowercase: true, normalize: true });
    let deviceAttributes: { [key: string]: string; } | null = null;
    saxStream.on("error", (e) => {
        console.error(`Can't parse results of the ${URL}`, e)
    });
    saxStream.on("opentag", (node: Tag) => {
        if (node.name == 'datapoint' && deviceAttributes != null) {
            //debug('Found data point %j', node.attributes);            
            processDataPoint(deviceAttributes.name, node.attributes);
        } else if (node.name == 'device' && !node.isSelfClosing) {
            deviceAttributes = node.attributes;
            debug('Found device device, %j', node.attributes);
        }
    });
    saxStream.on('closetag', (tagName) => {
        if (tagName == 'device') {
            deviceAttributes = null;
        }
    });
    console.log(`Loading XML data from ${URL}`);
    return new Promise<void>((ok) => {
        saxStream.on('end', () => {
            console.log('Parsing finished');
            ok();
        });
        stream.pipeline(got.stream(URL), saxStream, (err) => {
            console.error('Error happened', err);
        });
    });
}

function processDataPoint(deviceName: string, attr: { [key: string]: string }) {
    try {
        if (gauges[attr.type]) {
            const gauge = gauges[attr.type];
            const [deviceType, deviceId] = attr.name.split('.');
            debug(`Found measurement ${attr.type}`, { deviceName, deviceType, deviceId, value: attr.value, valueType: attr.valuetype });
            if (attr.valuetype == "4" && attr.value && attr.value.length > 0) {
                // Float values
                const value: number = parseFloat(attr.value);
                gauge.labels(deviceName, deviceType, deviceId).set(value);
            } else if (attr.valuetype == "2" && attr.value && attr.value.length > 0) {
                // Boolean
                const value: boolean = attr.value == 'true';
                gauge.labels(deviceName, deviceType, deviceId).set(value ? 1 : 0);
            } else if (attr.valuetype == "16" && attr.value && attr.value.length > 0) {
                // Percentage
                const value: number = parseInt(attr.value);
                gauge.labels(deviceName, deviceType, deviceId).set(100);
            } else if (attr.valuetype == "8" && attr.value && attr.value.length > 0) {
                // No f.king idea what valuetype == 8 means but it seems to be a number
                const value: number = parseInt(attr.value);
                gauge.labels(deviceName, deviceType, deviceId).set(value);
            }
        }
    } catch (err) {
        console.error(`Failed to parse attribute values ${JSON.stringify(attr)}`, err);
    }
}

(async () => {
    try {
        console.log('Starting HM Exporter');
        //const version = await xmlApi.getVersion();
        //console.log(`XML Addon version ${version} is found on CCU`);
        const port = process.env.PORT || 9140;
        console.log(
            `Server listening to ${port}, metrics exposed on /metrics endpoint`,
        );
        server.listen(port);
    } catch (e) {
        console.log(e);
    }
})();
