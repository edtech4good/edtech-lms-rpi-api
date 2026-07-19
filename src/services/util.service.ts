/* eslint-disable @typescript-eslint/no-explicit-any */
import { parseISO } from 'date-fns';
// @ts-ignore
import fileExtension from "file-extension";
import { ExtractJwt } from 'passport-jwt';
import { FileType } from 'src/models/enums/filetype.enum.';
import { FileMeta } from 'src/models/filemeta.model';
import { IMultiFilter } from 'src/models/IPaging';
import { replaceAll, stripBom, stripTags, trim } from "voca";
import { Config } from '../config';
import { TokenType } from './../models/enums';

export const jwtoptionsbuilder = (tokenformat: TokenType) => {
  switch (tokenformat) {
    case TokenType.ACCESS:
      return {
        secretOrKey: Config.fortyk.api.rpi.applicationsecret,
        jwtFromRequest: ExtractJwt.fromExtractors([
          ExtractJwt.fromAuthHeaderAsBearerToken(),
          ExtractJwt.fromBodyField(`accesstoken`),
          ExtractJwt.fromUrlQueryParameter(`accesstoken`),
        ]),
      };
  }
};
const cleantext = (text: string) =>
  text
    ? replaceAll(stripBom(stripTags(text)), ' ', '')
    : '';
export const filenameextractor = (filename: string): FileMeta => {
  const actualfilename = cleantext(trim(filename) || 'invalid');
  const actualfilenameext = cleantext(
    fileExtension(actualfilename) || 'invalid'
  );
  let storagefiletype = -1;
  switch (actualfilenameext.toLowerCase()) {
    case 'mp3':
      storagefiletype = FileType.AUDIO;
      break;
    case 'jpg':
    case 'png':
    case 'jpeg':
    case 'gif':
      storagefiletype = FileType.IMAGE;
      break;
    case 'mp4':
      storagefiletype = FileType.VIDEO;
      break;
    default:
      storagefiletype = FileType.INVALID;
  }
  return {
    filename: actualfilename,
    filetype: storagefiletype,
    fileext: actualfilenameext,
  };
};

export const rawfilenameextractor = (filename: string): FileMeta => {
  const actualfilename = (trim(filename) || 'invalid');
  const actualfilenameext = (
    fileExtension(actualfilename) || 'invalid'
  );
  let storagefiletype = -1;
  switch (actualfilenameext.toLowerCase()) {
    case 'mp3':
      storagefiletype = FileType.AUDIO;
      break;
    case 'jpg':
    case 'png':
    case 'jpeg':
    case 'gif':
      storagefiletype = FileType.IMAGE;
      break;
    case 'mp4':
      storagefiletype = FileType.VIDEO;
      break;
    default:
      storagefiletype = FileType.INVALID;
  }
  return {
    filename: actualfilename,
    filetype: storagefiletype,
    fileext: actualfilenameext,
  };
};

export const replacecaseInsensitive = (input: string, find: string) => {
  const reg = new RegExp(find, "gi")
  return input.replace(reg, "");
}

export const buildCustomWhere = (
  filters: Array<IMultiFilter>,
  wantToSearch: { fields: string, where: any, key?: string }
) => {
  filters.forEach(filter => {
    if((filter.key === wantToSearch.fields || (wantToSearch.key && filter.key === wantToSearch.key)) && filter.value) {
      // if (Object.prototype.hasOwnProperty.call(T, wantToSearch.fields)){
      // }
      wantToSearch.where[wantToSearch.fields] = filter.value;
      const date = parseISO(filter.value as string) ?? null;
      if(date && !isNaN(date.getTime())) {
        wantToSearch.where[wantToSearch.fields] = date;
      }
    }
  });
}
