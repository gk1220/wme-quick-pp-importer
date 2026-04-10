import { WmeSDK } from "wme-sdk-typings";

// Das SDK initScript wird aufgerufen, sobald das SDK bereit ist
window.SDK_INITIALIZED.then(initScript);

function initScript() {
    if (!window.getWmeSdk) {
        throw new Error("SDK not available");
    }
    const wmeSDK: WmeSDK = window.getWmeSdk(
        {
            scriptId: "wme-quick-pp-importer",
            scriptName: "WME Quick PP Importer"
        }
    )

    console.log(`WME Quick PP Importer: SDK v. ${wmeSDK.getSDKVersion()} initialized`);

    function addLayer() {
        const layerName = "Quick PP Importer";
        
        wmeSDK.Map.addLayer({
            layerName: layerName
        });

        wmeSDK.LayerSwitcher.addLayerCheckbox({
            name: layerName,
        })
    }

    async function addScriptTab() {
        const { tabLabel, tabPane } = await wmeSDK.Sidebar.registerScriptTab()
        tabLabel.innerText = "Quick PP"
        tabPane.innerHTML = `
            <div style="padding: 10px;">
                <h3>Quick PP Importer</h3>
                <p>Bereit zum Importieren.</p>
            </div>
        `
    }

    function init(): void {
        addScriptTab()
        addLayer()
        // Hier kommen später deine weiteren Funktionen rein
    }

    init()
}