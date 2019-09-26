import { EventEmitter, Event, env, Uri, window } from 'vscode';
import { v4 } from 'uuid';
import * as path from 'path';
import { readFileSync } from 'fs';
import * as http from 'http';
import * as url from 'url';

import { log } from '../logger';
import { keytar } from '../common';
import { KeytarKeys, TwitchKeys, LogLevel } from '../enums';
import { API } from './api';

export class AuthenticationService {
  private readonly _onAuthStatusChanged: EventEmitter<boolean> = new EventEmitter();
  public readonly onAuthStatusChanged: Event<boolean> = this._onAuthStatusChanged.event;

  constructor(private log: log) {}

  public async initialize() {
    if (keytar) {
      const accessToken = await keytar.getPassword(KeytarKeys.service, KeytarKeys.account);
      const userLogin = await keytar.getPassword(KeytarKeys.service, KeytarKeys.userLogin);

      if (accessToken && userLogin) {
        await API.validateToken(accessToken);
        this._onAuthStatusChanged.fire(true);
        return;
      }
    }
    this._onAuthStatusChanged.fire(false);
  }

  public async signInHandler() {
    if (keytar) {
      const accessToken = await keytar.getPassword(KeytarKeys.service, KeytarKeys.account);
      if (!accessToken) {
        const state = v4();
        this.createServer(state);
        env.openExternal(Uri.parse(`https://id.twitch.tv/oauth2/authorize?client_id=${TwitchKeys.clientId}` +
          `&redirect_uri=http://localhost:5544` +
          `&response_type=token&scope=${TwitchKeys.scope}` +
          `&force_verify=true` +
          `&state=${state}`));
      }
      else {
        const validResult = await API.validateToken(accessToken);
        if (validResult.valid) {
          this._onAuthStatusChanged.fire(true);
        }
      }
    }
  }

  public async signOutHandler() {
    if (keytar) {
      const token = await keytar.getPassword(KeytarKeys.service, KeytarKeys.account);
      if (token) {
        const revoked = await API.revokeToken(token);
        if (revoked) {
          window.showInformationMessage('Twitch token revoked successfully');
        }
      }
      keytar.deletePassword(KeytarKeys.service, KeytarKeys.account);
      keytar.deletePassword(KeytarKeys.service, KeytarKeys.userLogin);
    }
    this._onAuthStatusChanged.fire(false);
  }

  private createServer(state: string) {
    const file = readFileSync(path.join(__dirname, "/login/index.htm"));
    if (file) {
      const server = http.createServer(async (req, res) => {
        const mReq = url.parse(req.url!, true);
        const mReqPath = mReq.pathname;

        if (mReqPath === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(file);
        }
        else if (mReqPath === '/oauth') {
          const q: any = mReq.query;

          if (q.state !== state) {
            window.showErrorMessage('Error while logging in. State mismatch error.');
            await API.revokeToken(q.access_token);
            this._onAuthStatusChanged.fire(false);
            res.writeHead(500, 'Error while logging in. State mismatch error.');
            res.end();
            return;
          }

          res.writeHead(200);
          res.end(file);

          const validationResult = await API.validateToken(q.access_token);
          if (keytar && validationResult.valid) {
            keytar.setPassword(KeytarKeys.service, KeytarKeys.account, q.access_token);
            keytar.setPassword(KeytarKeys.service, KeytarKeys.userLogin, validationResult.login);
            this._onAuthStatusChanged.fire(true);
          }
        }
        else if (mReqPath === '/complete') {
          res.writeHead(200);
          res.end(file);
          setTimeout(() => server.close(), 3000);
        }
        else if (mReqPath === '/favicon.ico') {
          res.writeHead(204);
          res.end();
        }
      });

      server.listen('5544', (err: any) => {
        this.log(LogLevel.Error, err);
      });
    }
  }
}