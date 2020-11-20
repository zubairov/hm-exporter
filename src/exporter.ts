import { XmlApi } from "homematic-js-xmlapi";
import { Registry, collectDefaultMetrics, Gauge, register } from "prom-client";
import express from "express";

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
    }, 'VALVE_STATE': {
        metricName: 'ventil_state',
        help: 'State of the ventil of the heating'
    }, 'LEVEL': {
        metricName: 'ventil_level',
        help: 'Ventol level of the heating'
    }, 'BATTERY_STATE': {
        metricName: 'battery',
        help: 'Battery voltage level in Volt'
    }, 'SET_TEMPERATURE': {
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
    }
};

// Create gauges
const gauges: { [key: string]: Gauge<string> } = {};
for (const [metric, desc] of Object.entries(METRICS)) {
    gauges[metric] = new Gauge({
        name: METRIC_PREFIX + desc.metricName,
        help: desc.help,
        labelNames: ['device', 'channel', 'address']
    })
}

const unused: { [key: string]: boolean } = {};

const xmlApi = new XmlApi("192.168.178.31", 80);
collectDefaultMetrics({ gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]});

const server = express();
server.get('/metrics', async (req, res) => {
    try {
        await refreshData();
        res.set('Content-Type', register.contentType);
        res.end(register.metrics());
    } catch (ex) {
        console.error(ex);
        res.status(500).end(ex);
    }
});


(async () => {
    try {
        console.log('Starting HM Exporter');
        const version = await xmlApi.getVersion();
        console.log(`XML Addon version ${version} is found on CCU`);
        const port = process.env.PORT || 9140;
        console.log(
            `Server listening to ${port}, metrics exposed on /metrics endpoint`,
        );
        server.listen(port);
    } catch (e) {
        console.log(e);
    }
})();

async function refreshData() {
    console.log('Fetching devices');
    const devices = await xmlApi.getStateList();
    if (devices) {
        console.log(`Found ${devices?.length} devices`);
        for (const device of devices) {
            if (!device.name.startsWith('HM-RCV-50')) {
                for (const channel of device.channel.values()) {
                    //console.log(`\t`,channel.toString());
                    for (const dataPoint of channel.dataPoint.values()) {
                        const [type, ch, metric] = dataPoint.name.split('.');
                        if (gauges[metric]) {
                            //console.log(`\t\t${metric} of device=${device.name} channel=${channel.name} address=${ch} has value of ${dataPoint.value}`);
                            if (dataPoint.value) {
                                if (typeof dataPoint.value == 'boolean') {
                                    gauges[metric].labels(device.name, channel.name, ch).set(dataPoint.value?1:0);
                                } else if (typeof dataPoint.value == 'number') {
                                    gauges[metric].labels(device.name, channel.name, ch).set(dataPoint.value);
                                } else {
                                    try {
                                        const value = parseFloat(dataPoint.value);
                                        gauges[metric].labels(device.name, channel.name, ch).set(value);
                                    } catch (err) {
                                        console.error(`Failed to parse value ${dataPoint.value} of type ${typeof dataPoint.value} to float`, err);
                                    }
                                }
                            }
                        } else {
                            unused[metric] = true;
                        }
                    }
                }
            }
        }
        //console.log('Unused\n %s', Object.keys(unused).join('\n'));
    } else {
        throw new Error('No devices were found, something is wrong');
    }
}