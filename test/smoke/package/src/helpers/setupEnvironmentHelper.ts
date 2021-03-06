// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

import * as path from "path";
import * as utilities from "./utilities";
import * as fs from "fs";
import * as rimraf from "rimraf";
import * as cp from "child_process";
import * as semver from "semver";
import * as os from "os";
import { IosSimulatorHelper } from "./iosSimulatorHelper";
import { sleep, execSync } from "./utilities";
import { artifactsPath } from "../main";
import { AndroidEmulatorHelper } from "./androidEmulatorHelper";
import { SmokeTestLogger } from "./smokeTestLogger";
const XDL = require("@expo/xdl");

export class SetupEnvironmentHelper {

    private static SetupEnvironmentCommandsLogFile: string;

    public static expoPackageName = "host.exp.exponent";
    public static expoBundleId = "host.exp.Exponent";
    public static iOSExpoAppsCacheDir = `${os.homedir()}/.expo/ios-simulator-app-cache`;
    public static npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
    public static npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

    public static init() {
        SetupEnvironmentHelper.SetupEnvironmentCommandsLogFile = path.join(artifactsPath, "SetupEnvironmentCommandsLogs.txt");
    }

    public static prepareReactNativeApplication(workspaceFilePath: string, resourcesPath: string, workspacePath: string, appName: string, customEntryPointFolder: string, version?: string) {
        let command = `react-native init ${appName}`;
        if (version) {
            command += ` --version ${version}`;
        }
        SetupEnvironmentHelper.setupReactNativeApplication(workspaceFilePath, resourcesPath, workspacePath, customEntryPointFolder, command);
    }

    public static prepareHermesReactNativeApplication(workspaceFilePath: string, resourcesPath: string, workspacePath: string, appName: string, customEntryPointFolder: string, version?: string) {
        const commandClean = path.join(workspacePath, "android", "gradlew") + " clean";

        SmokeTestLogger.projectPatchingLog(`*** Executing  ${commandClean} ...`);
        cp.execSync(commandClean, { cwd: path.join(workspacePath, "android"), stdio: "inherit" });

        const customEntryPointFile = path.join(resourcesPath, customEntryPointFolder, "App.js");
        const testButtonPath = path.join(resourcesPath, customEntryPointFolder, "AppTestButton.js");

        SmokeTestLogger.projectPatchingLog(`*** Copying  ${customEntryPointFile} into ${workspaceFilePath}...`);
        fs.writeFileSync(workspaceFilePath, fs.readFileSync(customEntryPointFile));

        SetupEnvironmentHelper.copyGradleFilesToHermesApp(workspacePath, resourcesPath, customEntryPointFolder);

        SmokeTestLogger.projectPatchingLog(`*** Copying ${testButtonPath} into ${workspacePath}`);
        fs.copyFileSync(testButtonPath, path.join(workspacePath, "AppTestButton.js"));
    }

    public static prepareExpoApplication(workspaceFilePath: string, resourcesPath: string, workspacePath: string, appName: string, expoSdkMajorVersion?: string) {
        const useSpecificSdk = expoSdkMajorVersion ? `@sdk-${expoSdkMajorVersion}` : "";
        const command = `echo -ne '\\n' | expo init -t tabs${useSpecificSdk} --name ${appName} ${appName}`;
        SmokeTestLogger.projectInstallLog(`*** Creating Expo app via '${command}' in ${workspacePath}...`);
        execSync(command, { cwd: resourcesPath }, SetupEnvironmentHelper.SetupEnvironmentCommandsLogFile);

        const customEntryPointFile = path.join(resourcesPath, "ExpoSample", "App.tsx");
        const launchConfigFile = path.join(resourcesPath, "launch.json");
        const vsCodeConfigPath = path.join(workspacePath, ".vscode");

        SmokeTestLogger.projectPatchingLog(`*** Copying  ${customEntryPointFile} into ${workspaceFilePath}...`);
        fs.writeFileSync(workspaceFilePath, fs.readFileSync(customEntryPointFile));

        if (!fs.existsSync(vsCodeConfigPath)) {
            SmokeTestLogger.projectPatchingLog(`*** Creating  ${vsCodeConfigPath}...`);
            fs.mkdirSync(vsCodeConfigPath);
        }

        SmokeTestLogger.projectPatchingLog(`*** Copying  ${launchConfigFile} into ${vsCodeConfigPath}...`);
        fs.writeFileSync(path.join(vsCodeConfigPath, "launch.json"), fs.readFileSync(launchConfigFile));

        SetupEnvironmentHelper.patchMetroConfig(workspacePath);
    }

    public static prepareMacOSApplication(workspacePath: string) {
        const macOSinitCommand = "npx react-native-macos-init";
        SmokeTestLogger.projectPatchingLog(`*** Installing the React Native for macOS packages via '${macOSinitCommand}' in ${workspacePath}...`);
        execSync(macOSinitCommand, { cwd: workspacePath, stdio: "pipe" }, SetupEnvironmentHelper.SetupEnvironmentCommandsLogFile);
    }

    public static addExpoDependencyToRNProject(workspacePath: string, version?: string) {
        let expoPackage: string = version ? `expo@${version}` : "expo";
        const command = `${this.npmCommand} install ${expoPackage} --save-dev`;

        SmokeTestLogger.projectPatchingLog(`*** Adding expo dependency to ${workspacePath} via '${command}' command...`);
        execSync(command, { cwd: workspacePath }, SetupEnvironmentHelper.SetupEnvironmentCommandsLogFile);
    }

    public static cleanUp(testVSCodeDirectory: string, userDataDir: string, testLogsDirectory: string, workspacePaths: string[], iOSExpoAppsCacheDirectory: string) {
        SmokeTestLogger.info("\n*** Clean up...");
        if (fs.existsSync(testVSCodeDirectory)) {
            SmokeTestLogger.info(`*** Deleting test VS Code directory: ${testVSCodeDirectory}`);
            rimraf.sync(testVSCodeDirectory);
        }
        if (fs.existsSync(userDataDir)) {
            SmokeTestLogger.info(`*** Deleting VS Code temporary user data dir: ${userDataDir}`);
            rimraf.sync(userDataDir);
        }
        if (fs.existsSync(testLogsDirectory)) {
            SmokeTestLogger.info(`*** Deleting test logs directory: ${testLogsDirectory}`);
            rimraf.sync(testLogsDirectory);
        }
        workspacePaths.forEach(testAppFolder => {
            if (fs.existsSync(testAppFolder)) {
                SmokeTestLogger.info(`*** Deleting test application: ${testAppFolder}`);
                rimraf.sync(testAppFolder);
            }
        });
        if (fs.existsSync(iOSExpoAppsCacheDirectory)) {
            SmokeTestLogger.info(`*** Deleting iOS expo app cache directory: ${iOSExpoAppsCacheDirectory}`);
            rimraf.sync(iOSExpoAppsCacheDirectory);
        }
    }

    public static async getLatestSupportedRNVersionForExpo(expoSdkMajorVersion?: string): Promise<any> {
        const printSpecifiedMajorVersion = expoSdkMajorVersion ? `sdk-${expoSdkMajorVersion}` : "";
        const printIsLatest = printSpecifiedMajorVersion ? "" : "latest ";
        SmokeTestLogger.info(`*** Getting latest React Native version supported by ${printIsLatest}Expo ${printSpecifiedMajorVersion}...`);
        return new Promise((resolve, reject) => {
            utilities.getContents("https://exp.host/--/api/v2/versions", null, null, function (error, versionsContent) {
                if (error) {
                    reject(error);
                }
                try {
                    const content = JSON.parse(versionsContent);
                    if (content.sdkVersions) {
                        let usesSdkVersion: string | undefined;
                        if (expoSdkMajorVersion) {
                            usesSdkVersion = Object.keys(content.sdkVersions).find((version) => semver.major(version) === parseInt(expoSdkMajorVersion));
                            if (!usesSdkVersion) {
                                SmokeTestLogger.warn(`*** Сould not find the version of Expo sdk matching the specified version - ${printSpecifiedMajorVersion}`);
                            }
                        }
                        if (!usesSdkVersion) {
                            usesSdkVersion = Object.keys(content.sdkVersions).sort((ver1, ver2) => {
                                if (semver.lt(ver1, ver2)) {
                                    return 1;
                                } else if (semver.gt(ver1, ver2)) {
                                    return -1;
                                }
                                return 0;
                            })[0];
                        }
                        if (content.sdkVersions[usesSdkVersion]) {
                            if (content.sdkVersions[usesSdkVersion].facebookReactNativeVersion) {
                                SmokeTestLogger.info(`*** Latest React Native version supported by Expo ${printSpecifiedMajorVersion}: ${content.sdkVersions[usesSdkVersion].facebookReactNativeVersion}`);
                                resolve(content.sdkVersions[usesSdkVersion].facebookReactNativeVersion as string);
                            }
                        }
                    }
                    reject("Received object is incorrect");
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // Installs Expo app on Android device using XDL function
    public static async installExpoAppOnAndroid() {
        SmokeTestLogger.info(`*** Installing Expo app on Android emulator using Expo XDL function`);
        await XDL.Android.installExpoAsync({
            device: {
                name: AndroidEmulatorHelper.getOnlineDevices()[0].id,
                type: "emulator",
                isBooted: true,
                isAuthorized: true,
            }
        });
        AndroidEmulatorHelper.enableDrawPermitForApp(this.expoPackageName);
    }

    // Installs Expo app on iOS device using XDL function
    public static async installExpoAppOnIos() {
        SmokeTestLogger.info(`*** Installing Expo app on iOS simulator using Expo XDL function`);
        await XDL.Simulator.installExpoOnSimulatorAsync({
            simulator: {
                name: IosSimulatorHelper.getDevice() || "",
                udid: IosSimulatorHelper.getDeviceUdid() || ""
            }
        });
    }

    // Fix for https://github.com/expo/expo-cli/issues/951
    // TODO: Delete when bug will be fixed
    public static patchExpoSettingsFile(expoAppPath: string) {
        const settingsJsonPath = path.join(expoAppPath, ".expo", "settings.json");
        if (fs.existsSync(settingsJsonPath)) {
            SmokeTestLogger.projectPatchingLog(`*** Patching ${settingsJsonPath}...`);
            let content = JSON.parse(fs.readFileSync(settingsJsonPath).toString());
            if (content.https === false) {
                SmokeTestLogger.projectPatchingLog(`*** Deleting https: ${content.https} line...`);
                delete content.https;
                content = JSON.stringify(content, null, 2);
                fs.writeFileSync(settingsJsonPath, content);
            }
        }
    }

    public static setIosTargetToLaunchJson(workspacePath: string, configName: string, target?: string) {
        let launchJsonPath = path.join(workspacePath, ".vscode", "launch.json");
        if (target) {
            SmokeTestLogger.projectPatchingLog(`*** Implicitly adding target to "${configName}" config for ${launchJsonPath}`);
        }
        else {
            SmokeTestLogger.projectPatchingLog(`*** Implicitly remove target from "${configName}" config`);
        }
        let content = JSON.parse(fs.readFileSync(launchJsonPath).toString());
        let found = false;
        for (let i = 0; i < content.configurations.length; i++) {
            if (content.configurations[i].name === configName) {
                found = true;
                if (!target) {
                    delete content.configurations[i].target;
                }
                else {
                    content.configurations[i].target = target;
                }
            }
        }
        if (!found) {
            throw new Error("Couldn't find \"Debug iOS\" configuration");
        }
        fs.writeFileSync(launchJsonPath, JSON.stringify(content, undefined, 4)); // Adds indentations
    }

    public static async runIosSimulator() {
        const device = <string>IosSimulatorHelper.getDevice();
        await this.terminateIosSimulator();
        // Wipe data on simulator
        await IosSimulatorHelper.eraseSimulator(device);
        SmokeTestLogger.info(`*** Executing iOS simulator with 'xcrun simctl boot "${device}"' command...`);
        await IosSimulatorHelper.bootSimulator(device);
        await sleep(15 * 1000);
    }

    public static async terminateIosSimulator() {
        const device = <string>IosSimulatorHelper.getDevice();
        await IosSimulatorHelper.shutdownSimulator(device);
    }

    public static terminateMacOSapp(appName: string) {
        SmokeTestLogger.info(`*** Searching for ${appName} macOS application process`);
        const searchForMacOSappProcessCommand = `ps -ax | grep ${appName}`;
        const searchResults = cp.execSync(searchForMacOSappProcessCommand).toString();
        // An example of the output from the command above:
        // 40943 ??         4:13.97 node /Users/user/Documents/rn_for_mac_proj/node_modules/.bin/react-native start --port 8081
        // 40959 ??         0:10.36 /Users/user/.nvm/versions/node/v10.19.0/bin/node /Users/user/Documents/rn_for_mac_proj/node_modules/metro/node_modules/jest-worker/build/workers/processChild.js
        // 41004 ??         0:21.34 /Users/user/Library/Developer/Xcode/DerivedData/rn_for_mac_proj-ghuavabiztosiqfqkrityjoxqfmv/Build/Products/Debug/rn_for_mac_proj.app/Contents/MacOS/rn_for_mac_proj
        // 75514 ttys007    0:00.00 grep --color=auto --exclude-dir=.bzr --exclude-dir=CVS --exclude-dir=.git --exclude-dir=.hg --exclude-dir=.svn rn_for_mac_proj
        SmokeTestLogger.info(`*** Searching for ${appName} macOS application process: results ${JSON.stringify(searchResults)}`);

        if (searchResults) {
            const processIdRgx = /(^\d*)\s\?\?/g;
            //  We are looking for a process whose path contains the "appName.app" part
            const processData = searchResults.split("\n")
                .find(str => str.includes(`${appName}.app`));

            if (processData) {
                const match = processIdRgx.exec(processData);
                if (match && match[1]) {
                    SmokeTestLogger.info(`*** Terminating ${appName} macOS application process with PID ${match[1]}`);
                    const terminateMacOSappProcessCommand = `kill ${match[1]}`;
                    cp.execSync(terminateMacOSappProcessCommand);
                }
            }
        }
    }

    public static installExpoXdlPackageToExtensionDir(extensionDir: any, packageVersion: string) {
        const command = `${this.npmCommand} install @expo/xdl@${packageVersion} --no-save`;

        SmokeTestLogger.projectPatchingLog(`*** Adding @expo/xdl dependency to ${extensionDir} via '${command}' command...`);
        execSync(command, { cwd: extensionDir }, SetupEnvironmentHelper.SetupEnvironmentCommandsLogFile);
    }

    public static async patchMetroConfig(appPath: string) {
        const metroConfigPath = path.join(appPath, "metro.config.js");
        SmokeTestLogger.projectPatchingLog(`*** Patching  ${metroConfigPath}`);
        const patchContent = `
// Sometimes on Windows Metro fails to resolve files located at .vscode\.react directory and throws EPERM errors
// To avoid it this directory is added to black list for resolving by Metro
if (process.platform === "win32") {
    module.exports.resolver = {
        blacklistRE: /.*\.vscode\\\.react.*/
    };
}

// Redirect Metro cache
module.exports.cacheStores = [
    new (require('metro-cache')).FileStore({
        root: require('path').join(".cache", 'metro-cache'),
    }),
];

// Redirect Haste Map cache
module.exports.hasteMapCacheDirectory = ".cache";

// Due to the fact that Metro bundler on MacOS has problems with scanning files and folders starting with a dot (hidden folders), for example './vscode',
// the first time when the packager starts, it cannot find the './vscode/exponentIndex.js' file. So we add this folder to scanning manually.
module.exports.watchFolders = ['.vscode'];`;
        fs.appendFileSync(metroConfigPath, patchContent);
        const contentAfterPatching = fs.readFileSync(metroConfigPath);
        SmokeTestLogger.projectPatchingLog(`*** Content of a metro.config.js after patching: ${contentAfterPatching}`);
    }

    public static prepareRNWApplication(workspaceFilePath: string, resourcesPath: string, workspacePath: string, appName: string, customEntryPointFolder: string, version?: string): void {
        const setupCommand = `${this.npxCommand} --ignore-existing react-native init ${appName} --template react-native@^${version}`;
        SetupEnvironmentHelper.setupReactNativeApplication(workspaceFilePath, resourcesPath, workspacePath, customEntryPointFolder, setupCommand);
        const command = `${this.npxCommand} react-native-windows-init --overwrite`;
        SmokeTestLogger.projectPatchingLog(`*** Install additional RNW packages using ${command}`);
        execSync(command, { cwd: workspacePath, stdio: "pipe" }, SetupEnvironmentHelper.SetupEnvironmentCommandsLogFile);
    }

    private static copyGradleFilesToHermesApp(workspacePath: string, resourcesPath: string, customEntryPointFolder: string) {
        const appGradleBuildFilePath = path.join(workspacePath, "android", "app", "build.gradle");
        const resGradleBuildFilePath = path.join(resourcesPath, customEntryPointFolder, "build.gradle");

        SmokeTestLogger.projectPatchingLog(`*** Copying  ${resGradleBuildFilePath} into ${appGradleBuildFilePath}...`);
        fs.writeFileSync(appGradleBuildFilePath, fs.readFileSync(resGradleBuildFilePath));
    }

    private static setupReactNativeApplication(workspaceFilePath: string, resourcesPath: string, workspacePath: string, customEntryPointFolder: string, setupCommand: string) {
        SmokeTestLogger.projectInstallLog(`*** Creating RN app via '${setupCommand}' in ${workspacePath}...`);
        execSync(setupCommand, { cwd: resourcesPath }, SetupEnvironmentHelper.SetupEnvironmentCommandsLogFile);

        const customEntryPointFile = path.join(resourcesPath, customEntryPointFolder, "App.js");
        const launchConfigFile = path.join(resourcesPath, "launch.json");
        const vsCodeConfigPath = path.join(workspacePath, ".vscode");

        SmokeTestLogger.projectPatchingLog(`*** Copying  ${customEntryPointFile} into ${workspaceFilePath}...`);
        fs.writeFileSync(workspaceFilePath, fs.readFileSync(customEntryPointFile));

        if (!fs.existsSync(vsCodeConfigPath)) {
            SmokeTestLogger.projectPatchingLog(`*** Creating  ${vsCodeConfigPath}...`);
            fs.mkdirSync(vsCodeConfigPath);
        }

        SmokeTestLogger.projectPatchingLog(`*** Copying  ${launchConfigFile} into ${vsCodeConfigPath}...`);
        fs.writeFileSync(path.join(vsCodeConfigPath, "launch.json"), fs.readFileSync(launchConfigFile));

        SetupEnvironmentHelper.patchMetroConfig(workspacePath);
    }
}
