import {XmlApi} from "homematic-js-xmlapi";
import {Registry, collectDefaultMetrics} from "prom-client";


const xmlApi = new XmlApi("192.168.178.31", 80);

(async () => {
    try {
        console.log('Starting HM Exporter');
        const version = await xmlApi.getVersion();  
        console.log(`XML Addon versoin ${version} is found on CCU`);
        const devices = await xmlApi.getStateList();
        console.log('Found devices %j', devices);
    } catch (e) {
        console.log(e);
    }
})();
