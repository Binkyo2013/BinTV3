import Foundation

class SubtitleLoader {
    static func loadVTT(from urlString: String, completion: @escaping ([String]) -> Void) {
        guard let url = URL(string: urlString) else { completion([]); return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data = data, let text = String(data: data, encoding: .utf8) else { completion([]); return }
            let lines = text.components(separatedBy: .newlines)
            completion(lines)
        }.resume()
    }
}
