const request = require('request');
const core = require('@actions/core');

// create auth token for Jenkins API
const API_TOKEN = Buffer.from(`${core.getInput('user_name')}:${core.getInput('api_token')}`).toString('base64');

let timer = setTimeout(() => {
  core.setFailed("Job Timeout");
  core.error("Exception Error: Timed out");
  }, (Number(core.getInput('timeout')) * 1000));

const sleep = (seconds) => {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, (seconds * 1000));
  });
};

async function requestJenkinsJob(jobName, params) {
  const jenkinsEndpoint = core.getInput('url');
  const req = {
    method: 'POST',
    url: `${jenkinsEndpoint}/job/${jobName}/buildWithParameters`,
    form: params,
    headers: {
      'Authorization': `Basic ${API_TOKEN}`
    }
  }
  await new Promise((resolve, reject) => request(req)
    .on('response', (res) => {
      core.info(`>>> Job is started!`);
      resolve();
    })
    .on("error", (err) => {
      core.setFailed(err);
      core.error(JSON.stringify(err));
      clearTimeout(timer);
      reject();
    })
  );
}

async function getLastBuildStatus(jobName) {
    const jenkinsEndpoint = core.getInput('url');
    const req = {
        method: 'get',
        url: `${jenkinsEndpoint}/job/${jobName}/lastBuild/api/json`,
        headers: {
        'Authorization': `Basic ${API_TOKEN}`
        }
    }
    return new Promise((resolve, reject) =>
        request(req, (err, res, body) => {
            if (err) {
            clearTimeout(timer);
            reject(err);
            }
            try {
                const jsonBody = JSON.parse(body)
                resolve(jsonBody);
            } catch (e) {
                clearTimeout(timer);
                reject(e);
            }
        })
    );
}
async function getQueue() {
    const jenkinsEndpoint = core.getInput('url');
    const req = {
        method: 'get',
        url: `${jenkinsEndpoint}/queue/api/json`,
        headers: {
            'Authorization': `Basic ${API_TOKEN}`
        }
    }
    return new Promise((resolve, reject) =>
        request(req, (err, res, body) => {
            if (err) {
                clearTimeout(timer);
                reject(err);
            }
            try {
                const jsonBody = JSON.parse(body)
                resolve(jsonBody);
            } catch (e) {
                clearTimeout(timer);
                reject(e);
            }
        })
    );
}

function isJobInQueue(queueData, jobName, params) {
    const jobsInQueue = queueData.items.filter(e => e.task.name === jobName);
    if(!jobsInQueue) {
        return false;
    }
    const isExactJobInQueue = jobsInQueue.some(jobData => isAllJobParamsPresent(jobData, params));
    return isExactJobInQueue;
}

function isAllJobParamsPresent(jobData, expectedParams) {
    for (const [key, value] of Object.entries(expectedParams)) {
        const isParamPresent = jobData.actions[0].parameters.some(e =>
                key.toUpperCase() === 'TOKEN' || (e.name.toUpperCase() === key.toUpperCase() && e.value.toUpperCase() === value.toUpperCase())
            );

        if (!isParamPresent) {
            return false;
        }
    }
    return true;
}

async function waitJenkinsJob(jobName, timestamp, params) {
  core.info(`>>> Waiting for "${jobName}" ...`);
  await sleep(5);
  let checkQueue = true;
  let isJobWaitingInQueue = false
  while (true) {
    if (checkQueue) {
        const queueData = await getQueue();
        isJobWaitingInQueue = isJobInQueue(queueData, jobName, params);
    }
    if(!isJobWaitingInQueue) {
        checkQueue = false;
        let data = await getLastBuildStatus(jobName, params);
        if (data.timestamp < timestamp && isAllJobParamsPresent(data, params)) {
        core.info(`>>> Job is not started yet... Wait 5 seconds more...`)
        } else if (data.result == "SUCCESS") {
        core.info(`>>> Job "${data.fullDisplayName}" successfully completed!`);
        break;
        } else if (data.result == "FAILURE" || data.result == "ABORTED") {
        throw new Error(`Failed job ${data.fullDisplayName}`);
        } else {
        core.info(`>>> Job is running. Expected duration: ${data.estimatedDuration}`);
        }
    } else {
        core.info(`>>> Job is in queue, waiting to start "${jobName}" ...`);
    }
    await sleep(5); // API call interval
  }
}

async function main() {
  try {
    let params = {};
    let startTs = + new Date();
    let jobName = core.getInput('job_name');
    if (core.getInput('parameter')) {
      params = JSON.parse(core.getInput('parameter'));
      core.info(`>>> Parameter ${params.toString()}`);
    }
    // POST API call
    await requestJenkinsJob(jobName, params);

    // Waiting for job completion
    if (core.getInput('wait') == 'true') {
      await waitJenkinsJob(jobName, startTs, params);
    }
  } catch (err) {
    core.setFailed(err.message);
    core.error(err.message);
  } finally {
    clearTimeout(timer);
  }
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED="0";
main();
